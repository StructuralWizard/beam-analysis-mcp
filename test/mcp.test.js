// End-to-end MCP protocol test: spawns the real server over stdio and drives it
// with the official MCP client, the same way Claude Desktop / Claude Code would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');

test('MCP server: list tools, generate structure, analyze over stdio', async () => {
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const t of ['create_model', 'generate_structure', 'analyze', 'export_freecad', 'check_environment']) {
      assert.ok(names.includes(t), `missing tool ${t}`);
    }

    const gen = await client.callTool({
      name: 'generate_structure',
      arguments: { preset: 'truss_bridge', params: { type: 'warren', span: 48, panels: 6 }, name: 'e2e' },
    });
    const genObj = JSON.parse(gen.content[0].text);
    assert.equal(genObj.model, 'e2e');
    assert.ok(genObj.summary.members > 20);

    const an = await client.callTool({ name: 'analyze', arguments: { model: 'e2e', engine: 'beam' } });
    const res = JSON.parse(an.content[0].text);
    assert.equal(res.engine, 'beam');
    assert.ok(res.equilibrium.ok, 'equilibrium check failed');
    assert.ok(res.maxDisplacement.mm > 0 && res.maxDisplacement.mm < 1000);

    const forces = await client.callTool({
      name: 'get_results',
      arguments: { model: 'e2e', what: 'member_forces', ids: [1, 2, 3] },
    });
    const rows = JSON.parse(forces.content[0].text);
    assert.equal(rows.length, 3);
  } finally {
    await client.close();
  }
});
