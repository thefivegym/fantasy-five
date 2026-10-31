import re,json,sys,html
def nuxt(s):
    m=re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',s,re.S)
    if not m: return None
    return json.loads(m.group(1))
def resolve(arr,i,depth=0,seen=None):
    if depth>6: return None
    v=arr[i] if isinstance(i,int) and 0<=i<len(arr) else i
    if isinstance(v,dict): return {k:resolve(arr,x,depth+1) for k,x in v.items()}
    if isinstance(v,list):
        if v and isinstance(v[0],str) and v[0] in ('Reactive','ShallowReactive','Ref','ShallowRef','EmptyRef'): return resolve(arr,v[1],depth+1) if len(v)>1 else None
        if v and v[0] in ('Set','Map','Date'): return None
        return [resolve(arr,x,depth+1) for x in v]
    return v
def players(s):
    arr=nuxt(s)
    if arr is None: return None
    out=[]
    for i,v in enumerate(arr):
        if isinstance(v,dict) and 'firstName' in v and 'lastName' in v:
            out.append(resolve(arr,i,0))
    return out
if __name__=='__main__':
    s=open(sys.argv[1],errors='ignore').read()
    p=players(s)
    print(len(p) if p is not None else 'NO NUXT')
    for x in (p or [])[:3]: print(json.dumps({k:v for k,v in x.items() if not isinstance(v,(dict,list))})[:1500])
