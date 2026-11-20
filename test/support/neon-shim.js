// Test helper: a local stand-in for Neon's HTTP query endpoint, backed by a real local Postgres through psql.
// Starts its own throwaway cluster when the Postgres 16 binaries are installed; otherwise available() is false
// and the database tests are skipped.
import http from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const BIN = '/usr/lib/postgresql/16/bin', HOME = '/var/lib/postgresql', PORT = 54329;
const DIR = `${HOME}/ostest_${process.pid}`;
export const available = () => existsSync(`${BIN}/postgres`) && existsSync('/usr/bin/psql');

const asPg = (cmd, args) => execFileSync('runuser', ['-u', 'postgres', '--', `${BIN}/${cmd}`, ...args], { stdio: 'pipe' });
function psql(db, input) {
  const r = spawnSync('psql', ['-h', HOME, '-p', String(PORT), '-U', 'postgres', '-d', db, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || 'psql failed').replace(/^psql:[^:]*:\d+: /gm, '').trim());
  return r.stdout;
}
const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const bind = (q, params = []) => q.replace(/\$(\d+)/g, (_, n) => lit(params[+n - 1]));

let server, started = false, db;
export async function start() {
  if (!started) {
    try { asPg('pg_ctl', ['-D', DIR, 'stop', '-m', 'immediate']); } catch {}
    rmSync(DIR, { recursive: true, force: true });
    asPg('initdb', ['-D', DIR, '-U', 'postgres', '-A', 'trust']);
    asPg('pg_ctl', ['-D', DIR, '-o', `-p ${PORT} -k ${HOME} -c listen_addresses=''`, '-l', `${DIR}.log`, '-w', 'start']);
    started = true;
  }
  db = 'os_' + Math.random().toString(36).slice(2, 10);
  psql('postgres', `create database ${db};`);
  if (!server) {
    server = http.createServer((req, res) => {
      let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.queries) { psql(db, 'begin;\n' + j.queries.map(x => bind(x.query, x.params) + ';').join('\n') + '\ncommit;'); res.end(JSON.stringify({ results: j.queries.map(() => ({ rows: [] })) })); return; }
          const out = psql(db, bind(j.query, j.params) + ';').trim();
          res.end(JSON.stringify({ rows: out ? [[out]] : [], rowAsArray: true }));
        } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ message: e.message })); }
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
  }
  return `http://127.0.0.1:${server.address().port}/sql`;
}
export function stop() {
  if (server) { server.close(); server = null; }
  if (started) { try { asPg('pg_ctl', ['-D', DIR, 'stop', '-m', 'immediate']); } catch {} rmSync(DIR, { recursive: true, force: true }); rmSync(`${DIR}.log`, { force: true }); started = false; }
}
