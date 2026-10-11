// Coordinates live only in latest presence. Event history is not a location trail.
const COORD_KEYS = new Set(['lat','lng','latitude','longitude','coords','position'])
function stripCoordinates(value) {
 if(Array.isArray(value)) return value.map(stripCoordinates)
 if(!value || typeof value !== 'object') return value
 return Object.fromEntries(Object.entries(value).filter(([key])=>!COORD_KEYS.has(key.toLowerCase())).map(([key,v])=>[key,stripCoordinates(v)]))
}
export function minimizeSyncEvent(event) {
 if(!event || typeof event !== 'object') return event
 return {...event,data:stripCoordinates(event.data)}
}
export function scrubStoredSyncEvents(storage) {
 if(!storage) return
 for(let i=0;i<storage.length;i++) {
  const key=storage.key(i)
  if(!key?.startsWith('ptb:sync:')) continue
  try {
   const raw=storage.getItem(key), value=JSON.parse(raw)
   if(!Array.isArray(value?.events)) continue
   value.events=value.events.map(minimizeSyncEvent)
   const next=JSON.stringify(value)
   if(next!==raw) storage.setItem(key,next)
  } catch { /* unavailable storage: callers retain their existing fallback */ }
 }
}
