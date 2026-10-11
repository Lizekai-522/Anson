// Replay against the published snapshot, never infer identities from today's order.
export function replaySharedTodos(events, cards, segments) {
 const state = {}
 for (const e of [...(events || [])].sort((a,b)=>(a.at||0)-(b.at||0))) {
  if (!e || !['todo-done','todo-undone'].includes(e.type)) continue
  const snapshot=(cards||[]).find(c=>c.segId===e.segId)
  if (!snapshot) continue
  let seg=(segments||[]).find(s=>s.id===e.segId)
  if (!seg && /^seg\d+$/.test(e.segId)) {
   const matches=(segments||[]).filter(s=>s.type===snapshot.type && (s.date||'')===(snapshot.date||'') && (s.code||'')===(snapshot.code||'') && (s.from||'')===(snapshot.from||'') && (s.to||'')===(snapshot.to||''))
   if(matches.length===1) seg=matches[0]
  }
  if(!seg) continue
  const todos=seg.todos||[]
  let task=e.data?.taskId ? todos.find(t=>t.id===e.data.taskId) : null
  if(!e.data?.taskId) {
   const original=snapshot.todos?.[e.data?.index]
   const matches=todos.filter(t=>t.text===original?.text)
   if(matches.length===1) task=matches[0]
  }
  if(!task) continue
  const key=task.id || String(todos.indexOf(task))
  const set=state[seg.id] ||= new Set()
  if(e.type==='todo-done') set.add(key);else set.delete(key)
 }
 return state
}
