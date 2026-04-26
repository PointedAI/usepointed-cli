import { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { apiRequest } from "../lib/api-client.js";
import { printJson, printError, printSuccess } from "../lib/output.js";

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

interface CampaignExportPayload {
  campaign: {
    _id: string;
    title: string;
    description: string | null;
    status: string;
  };
  totalResponses: number;
  responses: ExportResponseBundle[];
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
): Promise<{ dir: string; warnings: string[] }> {
  const { bundle, downloads } = payload;
  const contactSlug = slugify(bundle.contact.name || "unknown");
  const dateSlug = new Date(bundle.response.createdAt)
    .toISOString()
    .slice(0, 10);
  const responseIdSuffix = bundle.response._id.split(":").pop() ?? bundle.response._id;
  const responseDir = join(
    outputDir,
    `response-${contactSlug}-${dateSlug}-${responseIdSuffix}`,
  );
  await mkdir(responseDir, { recursive: true });

  // Write the full bundle JSON
  await writeFile(
    join(responseDir, "response.json"),
    JSON.stringify(bundle, null, 2),
  );

  // Write per-round transcripts as individual text files
  for (const round of bundle.rounds) {
    if (round.transcript) {
      await writeFile(
        join(responseDir, `round-${round.roundNumber}-transcript.txt`),
        `Question: ${round.questionText}\n\n${round.transcript}`,
      );
    }
  }

  // Write AI summary if available
  if (bundle.response.aiSummary) {
    await writeFile(
      join(responseDir, "ai-summary.txt"),
      bundle.response.aiSummary,
    );
  }

  // Write insights if available
  if (bundle.insights.available) {
    await writeFile(
      join(responseDir, "insights.json"),
      JSON.stringify(bundle.insights, null, 2),
    );
  }

  // Write manifest
  await writeFile(
    join(responseDir, "manifest.json"),
    JSON.stringify(bundle.manifest, null, 2),
  );

  const warnings = [...bundle.manifest.processingWarnings];
  for (const video of downloads.videos) {
    if (video.status !== "ready" || !video.url) {
      warnings.push(
        `Round ${video.roundNumber}: ${video.reason ?? "video download unavailable"}`,
      );
      continue;
    }

    try {
      await downloadVideoFile(join(responseDir, video.fileName), video.url);
    } catch (error) {
      warnings.push(
        `Round ${video.roundNumber}: ${
          error instanceof Error ? error.message : "video download failed"
        }`,
      );
    }
  }

  return { dir: responseDir, warnings: [...new Set(warnings)] };
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
          if (options.responseId) {
            // Single response export
            const res = await apiRequest<ResponseExportDownloadPayload>(
              "GET",
              `/campaigns/${options.campaignId}/responses/${options.responseId}/export`,
            );
            if (!res.data) {
              printError("Response or campaign not found");
              process.exit(1);
            }
            const { dir, warnings } = await writeResponseBundle(
              options.outputDir,
              res.data,
            );
            printSuccess(`Exported response to ${dir}`);
            if (warnings.length > 0) {
              console.error(
                `Warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`,
              );
            }
          } else {
            // Full campaign export
            const res = await apiRequest<CampaignExportPayload>(
              "GET",
              `/campaigns/${options.campaignId}/export`,
              undefined,
              options.includeTest ? { includeTest: "true" } : undefined,
            );
            if (!res.data) {
              printError("Campaign not found");
              process.exit(1);
            }
            const campaignSlug = slugify(
              res.data.campaign.title || "campaign",
            );
            const campaignDir = join(
              options.outputDir,
              `campaign-${campaignSlug}`,
            );
            await mkdir(campaignDir, { recursive: true });

            // Write campaign-level metadata
            await writeFile(
              join(campaignDir, "campaign.json"),
              JSON.stringify(res.data.campaign, null, 2),
            );

            let totalWarnings = 0;
            for (const bundle of res.data.responses) {
              try {
                const responseExport = await apiRequest<ResponseExportDownloadPayload>(
                  "GET",
                  `/campaigns/${options.campaignId}/responses/${bundle.response._id}/export`,
                );
                if (!responseExport.data) {
                  totalWarnings += 1;
                  console.error(
                    `Warning: failed to load downloadable assets for response ${bundle.response._id}`,
                  );
                  continue;
                }
                const { warnings } = await writeResponseBundle(
                  campaignDir,
                  responseExport.data,
                );
                totalWarnings += warnings.length;
              } catch (error) {
                totalWarnings += 1;
                console.error(
                  `Warning: failed to export response ${bundle.response._id}: ${
                    error instanceof Error ? error.message : "request failed"
                  }`,
                );
              }
            }

            printSuccess(
              `Exported ${res.data.totalResponses} response(s) to ${campaignDir}`,
            );
            if (totalWarnings > 0) {
              console.error(
                `${totalWarnings} processing warning(s) across responses. Check individual manifest.json files for details.`,
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
        const res = await apiRequest<CampaignExportPayload>(
          "GET",
          `/campaigns/${options.campaignId}/export`,
          undefined,
          options.includeTest ? { includeTest: "true" } : undefined,
        );
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
