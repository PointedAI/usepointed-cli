import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

test('login and refresh carry the same resource and explicit consent through the real callback', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pointed-oauth-consent-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  const source = `
    import assert from 'node:assert/strict';
    import { createAuthCommand } from ${JSON.stringify(new URL('../dist/commands/auth.js', import.meta.url).href)};
    const nativeFetch = globalThis.fetch;
    const exchanges=[];
    globalThis.fetch=async (input,init) => {
      const url=String(input);
      if(url.includes('/.well-known/')) return Response.json({issuer:'https://issuer.example',authorization_endpoint:'https://issuer.example/authorize',token_endpoint:'https://issuer.example/token'});
      assert.equal(url,'https://issuer.example/token');
      const body=new URLSearchParams(init.body);
      assert.equal(body.get('resource'),'https://api.example/api/cli');
      exchanges.push(body);
      return Response.json({access_token:'oat_synthetic',refresh_token:'refresh-synthetic',expires_in:3600,token_type:'Bearer'});
    };
    let authorization;
    let adminExpected = true;
    const command=createAuthCommand(async raw => {
      authorization=new URL(raw);
      assert.equal(authorization.searchParams.get('resource'),'https://api.example/api/cli');
      const scopes=authorization.searchParams.get('scope').split(' ');
      for(const scope of ['offline_access','user:org:read','pointed:read','pointed:write','pointed:evidence','pointed:setup']) assert.ok(scopes.includes(scope));
      assert.equal(scopes.includes('pointed:admin'),adminExpected);
      assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
      const callback=new URL(authorization.searchParams.get('redirect_uri'));
      callback.searchParams.set('code','synthetic-code');
      callback.searchParams.set('state',authorization.searchParams.get('state'));
      const response=await nativeFetch(callback);
      assert.equal(response.status,200);
    });
    await command.parseAsync(['login','--clerk-domain','https://issuer.example','--admin'],{from:'user'});
    assert.equal(exchanges[0].get('grant_type'),'authorization_code');
    assert.ok(exchanges[0].get('code_verifier'));
    adminExpected = false;
    await command.parseAsync(['login','--clerk-domain','https://issuer.example'],{from:'user'});
    await createAuthCommand().parseAsync(['refresh','--clerk-domain','https://issuer.example'],{from:'user'});
    assert.equal(exchanges[2].get('grant_type'),'refresh_token');
    assert.equal(exchanges[2].get('refresh_token'),'refresh-synthetic');
  `;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{...process.env,HOME:directory,POINTED_API_KEY:'',POINTED_API_URL:'https://api.example'}});
    let output=''; child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    child.on('error',reject);child.on('close',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);
});

test('deployed provider discovery binds login and refresh to the same issuer, client and resource', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pointed-provider-discovery-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const script = `
    import assert from 'node:assert/strict';
    import os from 'node:os';
    import { syncBuiltinESMExports } from 'node:module';
    os.homedir = () => ${JSON.stringify(dir)};
    syncBuiltinESMExports();
    const {createAuthCommand} = await import(${JSON.stringify(new URL('../dist/commands/auth.js', import.meta.url).href)});
    const store = await import(${JSON.stringify(new URL('../dist/lib/auth-store.js', import.meta.url).href)});
    const {resolveClient, discoverEndpoints} = await import(${JSON.stringify(new URL('../dist/lib/oauth-client.js', import.meta.url).href)});
    const production = 'https://app.usepointed.ai';
    const clerk = 'https://clerk.usepointed.ai';
    const workos = 'https://pointed-qa.authkit.app';
    const nativeFetch = globalThis.fetch;
    delete process.env.CLERK_FRONTEND_API_URL;
    delete process.env.CLERK_OAUTH_CLIENT_ID;
    delete process.env.POINTED_CLI_OAUTH_CLIENT_ID;
    delete process.env.POINTED_OAUTH_ISSUER;
    let issuer = clerk;
    let clientId = 'qxCPM9BP0iFSRK9D';
    let status = 404;
    let observed = [];
    let corruptMetadata = false;
    const resource = () => new URL('/api/cli',process.env.POINTED_API_URL).href;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input);
      assert.equal(init.redirect,'error');
      if (url.pathname === '/api/cli/v1/auth/config') {
        if (status !== 200) return new Response(null,{status});
        return Response.json({issuer,clientId});
      }
      assert.equal(url.origin,issuer);
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return Response.json({issuer, authorization_endpoint:issuer+'/oauth2/authorize',token_endpoint:corruptMetadata?'https://other.example/token':issuer+'/oauth2/token'});
      }
      assert.equal(url.pathname,'/oauth2/token');
      const form=new URLSearchParams(init.body);
      assert.equal(form.get('resource'),resource());
      assert.equal(form.get('client_id'),clientId);
      observed.push({issuer,kind:form.get('grant_type'),token:form.get('refresh_token')});
      return Response.json({access_token:'local-token',refresh_token:'local-refresh-'+observed.length,expires_in:3600,token_type:'Bearer'});
    };
    async function signIn(){
      await createAuthCommand(async raw => {
        const url = new URL(raw);
        assert.equal(url.origin,issuer);
        assert.equal(url.searchParams.get('client_id'),clientId);
        assert.equal(url.searchParams.get('resource'),resource());
        assert.equal(url.searchParams.get('code_challenge_method'),'S256');
        const loopback = new URL(url.searchParams.get('redirect_uri'));
        loopback.searchParams.set('code','synthetic');
        loopback.searchParams.set('state',url.searchParams.get('state'));
        assert.equal((await nativeFetch(loopback)).status,200);
      }).parseAsync(['login'],{from:'user'});
    }
    const refresh = () => createAuthCommand().parseAsync(['refresh'],{from:'user'});
    process.env.POINTED_API_URL=production;
    await signIn();
    await refresh();
    assert.equal(observed[1].token,'local-refresh-1');
    status=200;
    await refresh();
    assert.equal(observed[2].token,'local-refresh-2');
    async function expectReconnect(){
      // The command prints a clean re-login message and exits without exchanging the old token.
      const count=observed.length;
      const exit=process.exit;
      try {
        process.exit=code=>{throw new Error('expected CLI exit '+code);};
        await assert.rejects(refresh,/expected CLI exit 1/);
      } finally {process.exit=exit;}
      assert.equal(observed.length,count);
    }
    issuer=workos;clientId='client_test_public';
    await expectReconnect();
    await signIn();
    const creds=store.loadCredentials();
    assert.equal(creds.issuer,workos);assert.equal(creds.clientId,clientId);assert.equal(creds.resource,resource());
    await refresh();assert.equal(observed.at(-1).token,'local-refresh-4');
    clientId='other_client';await expectReconnect();clientId='client_test_public';
    process.env.POINTED_API_URL='https://another-deployment.example';
    assert.equal(store.getAuthToken(),null);
    await expectReconnect();
    process.env.POINTED_API_URL=production;
    store.saveCredentials({accessToken:'old-token',refreshToken:'old-refresh',expiresAt:Date.now()+3600_000,tokenType:'oauth'});
    assert.equal(store.getAuthToken(),'old-token');
    await expectReconnect();
    corruptMetadata=true;
    await assert.rejects(discoverEndpoints(workos),/Invalid OAuth endpoint/);
    status=503;await assert.rejects(resolveClient({}),/503/);
    status=404;process.env.POINTED_API_URL='https://custom-pointed.example';
    await assert.rejects(resolveClient({}),/404/);
  `;
  const result = await new Promise((resolve,reject) => {
    const proc = spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,POINTED_API_KEY:''}});
    let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
    proc.on('error',reject);proc.on('close',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);
});
