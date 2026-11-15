import sys,json,sqlite3
c=sqlite3.connect(sys.argv[1],isolation_level=None,timeout=15)
c.row_factory=sqlite3.Row
for line in sys.stdin:
 try:
  q=json.loads(line)
  if q['op']=='close': c.close();print('{}',flush=True);break
  cur=c.execute(q['sql'],q.get('args',[]))
  result=([dict(x) for x in cur.fetchall()] if q['op']=='all' else dict(r) if (r:=cur.fetchone()) else None) if q['op']!='run' else {'changes':cur.rowcount,'lastID':cur.lastrowid}
  print(json.dumps({'result':result}),flush=True)
 except Exception as e: print(json.dumps({'error':str(e)}),flush=True)
