// src/lib/logistics/writeFence.ts
// Single source of truth for the v2 logistics write fence. Was previously duplicated as a local
// const in bols/route.ts and bols/[id]/route.ts (identical value/behavior in both); hoisted here
// per xpanda-ops-agents.md §9a H5 so the eventual flip is a one-file change, and so the new
// shipments/[id]/route.ts (PUT) can share it instead of declaring a third copy.
// Read/write fence (DEFAULT prod-D1 safety). Flip only in the dedicated write-enable phase, once
// Steve has reviewed the fenced logic below live.
export const V2_LOGISTICS_WRITES_ENABLED = false;
