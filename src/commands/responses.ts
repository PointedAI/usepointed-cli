import { Command } from "commander";
import { basename } from "node:path";
import { createPrivateExportDirectory, exportFilePath, writePrivateExport as writeFile } from "../lib/private-files.js";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError, printSuccess, printWarning } from "../lib/output.js";
import { encodeId } from "../lib/validation.js";

interface ExportRound {
  roundNumber: number;
  questionText: string;
  transcript: string | null;
  transcriptionStatus: string;
  videoStatus: string;
  muxPlaybackId: string | null;
  muxAssetId: string | null;
  videoDurationSecs: number | null;
}

interface ExportResponseBundle {
  exportVersion: number;
  exportedAt: string;
  response: {
    _id: string;
    status: string;
    currentRound: number;
    aiSummary: string | null;
    sentimentScore: number | null;
    createdAt: number;
    completedAt: number | null;
  };
  contact: {
    name: string;
    email: string;
    title: string | null;
  };
  campaign: {
    _id: string;
    title: string;
    description: string | null;
    initialQuestion: string;
    maxRounds: number;
    status: string;
  };
  rounds: ExportRound[];
  insights: {
    available: boolean;
    executiveSummary: string | null;
    keyThemes: string[];
    topQuotes: string[];
    sentimentBreakdown: unknown;
    generatedAt: number | null;
    model: string | null;
  };
  manifest: {
    totalRounds: number;
    roundsWithTranscript: number;
    roundsWithVideo: number;
    hasAiSummary: boolean;
    hasSentiment: boolean;
    hasInsights: boolean;
    processingWarnings: string[];
  };
}

interface ResponseVideoDownload {
  roundNumber: number;
  fileName: string;
  url: string | null;
  status: "ready" | "preparing" | "unavailable";
  reason: string | null;
}

interface ResponseExportDownloadPayload {
  bundle: ExportResponseBundle;
  downloads: {
    bundleFileName: string;
    videos: ResponseVideoDownload[];
  };
}

interface VideoExportOutcome {
  roundNumber: number;
  fileName: string;
  status: "downloaded" | "preparing" | "unavailable" | "failed";
  reason: string | null;
}

interface ResponseExportOutcome {
  responseId: string;
  status: "exported" | "partial" | "failed";
  directory?: string;
  warnings: string[];
}

interface CampaignExportPayload {
  campaign: {
    _id: string;
    title: string;
    description: string | null;
    status: string;
  };
  totalResponses: number;
  responses: ExportResponseBundle[];
  isDone?: boolean;
  continueCursor?: string | null;
}

async function campaignExport(campaignId: string, includeTest: boolean) {
  let combined: CampaignExportPayload | null = null;
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const result = await apiRequest<CampaignExportPayload>("GET", `/campaigns/${encodeId(campaignId)}/export`, undefined, {
      pageSize: "1", ...(includeTest ? { includeTest: "true" } : {}), ...(cursor ? { cursor } : {}),
    });
    if (!result.data) return { ...result, data: null };
    if (!combined) combined = { ...result.data, responses: [], totalResponses: 0 };
    combined.responses.push(...result.data.responses);
    combined.totalResponses += result.data.responses.length;
    if (result.data.isDone !== false) return { ...result, data: combined };
    const next = result.data.continueCursor;
    if (typeof next !== "string" || !next || seen.has(next)) throw new Error("Campaign export returned an invalid continuation cursor");
    seen.add(next);
    cursor = next;
  } while (cursor);
  throw new Error("Campaign export did not complete");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function downloadVideoFile(outputPath: string, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Video download failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

async function writeResponseBundle(
  outputDir: string,
  payload: ResponseExportDownloadPayload,
): Promise<{ dir: string; warnings: string[]; failedDownloads: number }> {
  const { bundle, downloads } = payload;
  const contactSlug = slugify(bundle.contact.name || "unknown");
  const dateSlug = new Date(bundle.response.createdAt)
    .toISOString()
    .slice(0, 10);
  const responseIdSuffix = slugify(bundle.response._id.split(":").pop() ?? bundle.response._id).slice(0, 64);
  const responseDir = createPrivateExportDirectory(outputDir,
    `response-${contactSlug.slice(0, 64)}-${dateSlug}-${responseIdSuffix}`);

  // Write the full bundle JSON
  await writeFile(
    exportFilePath(responseDir, "response.json"),
    JSON.stringify(bundle, null, 2),
  );

  // Write per-round transcripts as individual text files
  for (const round of bundle.rounds) {
    if (round.transcript) {
      await writeFile(
        exportFilePath(responseDir, `round-${round.roundNumber}-transcript.txt`),
        `Question: ${round.questionText}\n\n${round.transcript}`,
      );
    }
  }

  // Write AI summary if available
  if (bundle.response.aiSummary) {
    await writeFile(
      exportFilePath(responseDir, "ai-summary.txt"),
      bundle.response.aiSummary,
    );
  }

  // Write insights if available
  if (bundle.insights.available) {
    await writeFile(
      exportFilePath(responseDir, "insights.json"),
      JSON.stringify(bundle.insights, null, 2),
    );
  }

  const warnings = [...bundle.manifest.processingWarnings];
  const videoDownloads: VideoExportOutcome[] = [];
  let failedDownloads = 0;
  for (const video of downloads.videos) {
    if (video.status !== "ready" || !video.url) {
      const reason = video.reason ?? "video download unavailable";
      warnings.push(`Round ${video.roundNumber}: ${reason}`);
      videoDownloads.push({
        roundNumber: video.roundNumber,
        fileName: video.fileName,
        status: video.status === "preparing" ? "preparing" : "unavailable",
        reason,
      });
      continue;
    }

    try {
      // Keep the local outcome manifest available even if the API supplies a
      // colliding video name (including on case-insensitive file systems).
      if (video.fileName.toLowerCase() === "manifest.json") {
        throw new Error("Video file name conflicts with manifest.json");
      }
      await downloadVideoFile(exportFilePath(responseDir, video.fileName), video.url);
      videoDownloads.push({
        roundNumber: video.roundNumber,
        fileName: video.fileName,
        status: "downloaded",
        reason: null,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "video download failed";
      warnings.push(`Round ${video.roundNumber}: ${reason}`);
      failedDownloads += 1;
      videoDownloads.push({
        roundNumber: video.roundNumber,
        fileName: video.fileName,
        status: "failed",
        reason,
      });
    }
  }

  const finalWarnings = [...new Set(warnings)];
  await writeFile(
    exportFilePath(responseDir, "manifest.json"),
    JSON.stringify({ ...bundle.manifest, processingWarnings: finalWarnings, videoDownloads }, null, 2),
  );

  return { dir: responseDir, warnings: finalWarnings, failedDownloads };
}

export function createResponsesCommand(): Command {
  const responses = new Command("responses").description(
    "Download and export survey responses",
  );

  responses
    .command("download")
    .description("Download response exports for a campaign")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .option("--response-id <id>", "Single response ID (omit for all)")
    .option(
      "--output-dir <dir>",
      "Output directory",
      "./pointed-export",
    )
    .option(
      "--include-test",
      "Include responses from test survey invites",
      false,
    )
    .action(
      async (options: {
        campaignId: string;
        responseId?: string;
        outputDir: string;
        includeTest: boolean;
      }) => {
        try {
          if (options.responseId !== undefined) {
            // Single response export
            const res = await apiRequest<ResponseExportDownloadPayload>(
              "GET",
              `/campaigns/${encodeId(options.campaignId)}/responses/${encodeId(options.responseId)}/export`,
            );
            if (!res.data) {
              printError("Response or campaign not found");
              process.exit(1);
            }
            const { dir, warnings, failedDownloads } = await writeResponseBundle(
              options.outputDir,
              res.data,
            );
            if (failedDownloads > 0) {
              printError(`Response export is incomplete: ${failedDownloads} video download(s) failed. Saved files to ${dir}`);
              process.exitCode = 1;
            } else {
              printSuccess(`Exported response to ${dir}`);
            }
            if (warnings.length > 0) {
              printWarning(
                `Warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`,
              );
            }
          } else {
            // Full campaign export
            const res = await campaignExport(options.campaignId, options.includeTest);
            if (!res.data) {
              printError("Campaign not found");
              process.exit(1);
            }
            const campaignSlug = slugify(
              res.data.campaign.title || "campaign",
            );
            const campaignDir = createPrivateExportDirectory(options.outputDir,
              `campaign-${campaignSlug.slice(0, 64)}`);

            // Write campaign-level metadata
            await writeFile(
              exportFilePath(campaignDir, "campaign.json"),
              JSON.stringify(res.data.campaign, null, 2),
            );

            let totalWarnings = 0;
            let exportedResponses = 0;
            const outcomes: ResponseExportOutcome[] = [];
            for (const bundle of res.data.responses) {
              try {
                const responseExport = await apiRequest<ResponseExportDownloadPayload>(
                  "GET",
                  `/campaigns/${encodeId(options.campaignId)}/responses/${encodeId(bundle.response._id)}/export`,
                );
                if (!responseExport.data) {
                  throw new Error("Failed to load downloadable assets");
                }
                const { dir, warnings, failedDownloads } = await writeResponseBundle(
                  campaignDir,
                  responseExport.data,
                );
                totalWarnings += warnings.length;
                if (failedDownloads === 0) exportedResponses += 1;
                outcomes.push({
                  responseId: bundle.response._id,
                  status: failedDownloads > 0 ? "partial" : "exported",
                  directory: basename(dir),
                  warnings,
                });
              } catch (error) {
                const reason = error instanceof Error ? error.message : "request failed";
                totalWarnings += 1;
                outcomes.push({ responseId: bundle.response._id, status: "failed", warnings: [reason] });
                printWarning(
                  `Warning: failed to export response ${bundle.response._id}: ${reason}`,
                );
              }
            }

            const failedResponses = outcomes.filter(outcome => outcome.status !== "exported").length;
            await writeFile(
              exportFilePath(campaignDir, "manifest.json"),
              JSON.stringify({ totalResponses: res.data.totalResponses, exportedResponses, failedResponses, responses: outcomes }, null, 2),
            );
            const summary = `Exported ${exportedResponses} of ${res.data.totalResponses} response(s) to ${campaignDir}`;
            if (failedResponses > 0) {
              printError(`${summary}. ${failedResponses} response export(s) incomplete; completed files were preserved.`);
              process.exitCode = 1;
            } else {
              printSuccess(summary);
            }
            if (totalWarnings > 0) {
              printWarning(
                `${totalWarnings} processing warning(s) across responses. Check campaign and individual manifest.json files for details.`,
              );
            }
          }
        } catch (error) {
          printError(
            error instanceof Error ? error.message : "Request failed",
          );
          process.exit(1);
        }
      },
    );

  responses
    .command("list")
    .description("List responses for a campaign (metadata only)")
    .requiredOption("--campaign-id <id>", "Campaign ID")
    .option(
      "--include-test",
      "Include responses from test survey invites",
      false,
    )
    .action(async (options: { campaignId: string; includeTest: boolean }) => {
      try {
        const res = await campaignExport(options.campaignId, options.includeTest);
        if (!res.data) {
          printError("Campaign not found");
          process.exit(1);
        }
        const summary = res.data.responses.map((bundle) => ({
          responseId: bundle.response._id,
          contact: bundle.contact.name,
          status: bundle.response.status,
          rounds: bundle.manifest.totalRounds,
          hasAiSummary: bundle.manifest.hasAiSummary,
          hasSentiment: bundle.manifest.hasSentiment,
          warnings: bundle.manifest.processingWarnings.length,
        }));
        printJson(summary);
      } catch (error) {
        printError(
          error instanceof Error ? error.message : "Request failed",
        );
        process.exit(1);
      }
    });

  return responses;
}
