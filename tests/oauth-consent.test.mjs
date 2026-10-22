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
      for(const scope of ['user:org:read','pointed:read','pointed:write','pointed:evidence','pointed:setup']) assert.ok(scopes.includes(scope));
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
