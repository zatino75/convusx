type ThreadMessage = {
role:string
content:any
timestamp:number
}

type ThreadMemory = {
messages:ThreadMessage[]
}

const ThreadStore:Record<string,ThreadMemory> = {}

export function appendThreadMemory(threadId:string,role:string,content:any){

const mem =
ThreadStore[threadId] ??
{messages:[]}

mem.messages.push({
role,
content,
timestamp:Date.now()
})

if(mem.messages.length > 50){
mem.messages.shift()
}

ThreadStore[threadId] = mem

}

export function getThreadMemory(threadId:string){

return ThreadStore[threadId]?.messages ?? []

}

export function mergeThreadMemories(threadIds:string[]){

const merged:any[] = []

for(const id of threadIds){

const mem =
ThreadStore[id]?.messages ??
[]

for(const m of mem){
merged.push(m)
}

}

merged.sort((a,b)=>a.timestamp-b.timestamp)

return merged

}
