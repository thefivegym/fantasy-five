import re,json,html
from collections import Counter
from sidearm import nuxt,resolve,players as sidearm_nuxt_players
def clean(t): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',t or ''))).strip()
def wmt(s):
    a=nuxt(s)
    if not a: return None
    ents=[]
    for i,v in enumerate(a):
        if isinstance(v,dict) and 'player' in v and 'class_level' in v and 'roster_id' in v:
            r=resolve(a,i,0)
            p=r.get('player') or {}
            if not isinstance(p,dict) or not p.get('first_name'): continue
            cl=r.get('class_level') or {}
            ros=r.get('roster') or {}
            ents.append({'first':p['first_name'],'last':p['last_name'],'year':(cl.get('abbreviation') or cl.get('name')) if isinstance(cl,dict) else None,
                         'hometown':p.get('hometown'),'prev':p.get('previous_school'),'roster_id':r.get('roster_id'),
                         'roster_title':(ros.get('title') or ros.get('name')) if isinstance(ros,dict) else None, 'pid':r.get('player_id')})
    if not ents: return None
    rid=Counter(e['roster_id'] for e in ents).most_common(1)[0][0]
    seen=set(); out=[]
    for e in ents:
        if e['roster_id']!=rid or e['pid'] in seen: continue
        seen.add(e['pid']); out.append(e)
    return out
def classic(s):
    out=[]
    for blk in re.split(r'<li[^>]+class="sidearm-roster-player[ "]',s)[1:]:
        blk=blk[:6000]
        m=re.search(r'class="sidearm-roster-player-name"[^>]*>(.*?)</(?:div|h3|p)>',blk,re.S)
        if not m: continue
        nm=clean(m.group(1))
        nm=re.sub(r'^\d+\s+','',nm)
        fn=re.search(r'data-player-first-name="([^"]*)"',blk); ln=re.search(r'data-player-last-name="([^"]*)"',blk)
        yr=re.search(r'class="sidearm-roster-player-academic-year[^"]*"[^>]*>(.*?)</span>',blk,re.S)
        ht=re.search(r'class="sidearm-roster-player-hometown"[^>]*>(.*?)</span>',blk,re.S)
        prev=re.search(r'class="sidearm-roster-player-previous-school"[^>]*>(.*?)</span>',blk,re.S)
        if fn and ln: first,last=html.unescape(fn.group(1)),html.unescape(ln.group(1))
        else:
            parts=nm.split(' ',1); first,last=parts[0],parts[1] if len(parts)>1 else ''
        out.append({'first':first.strip(),'last':last.strip(),'year':clean(yr.group(1)) if yr else None,'hometown':clean(ht.group(1)) if ht else None,'prev':clean(prev.group(1)) if prev else None})
    return out or None
def classic_season(s):
    m=re.search(r'<select[^>]*id="ddl_past_rosters"[^>]*>.*?<option[^>]*selected[^>]*>([^<]*)',s,re.S)
    return clean(m.group(1)) if m else None
def nuxt_sidearm(s):
    p=sidearm_nuxt_players(s)
    if not p: return None
    seen=set(); out=[]
    for x in p:
        k=x.get('rosterPlayerId') or (x['firstName'],x['lastName'])
        if k in seen: continue
        if not (isinstance(x.get('academicYearShort'),str) and x.get('academicYearShort').strip()) and not (isinstance(x.get('positionShort'),str) and x.get('positionShort').strip()): continue
        seen.add(k)
        out.append({'first':x['firstName'],'last':x['lastName'],'year':x.get('academicYearShort'),'hometown':x.get('hometown'),'prev':x.get('previousSchool')})
    return out
def nuxt_season(s):
    a=nuxt(s)
    if not a: return None
    titles=[]
    for i,v in enumerate(a):
        if isinstance(v,dict) and 'title' in v and ('isCurrent' in v or 'seasonId' in v or 'sport' in v):
            t=a[v['title']] if isinstance(v['title'],int) else v['title']
            if isinstance(t,str) and re.match(r'^20\d\d(-\d\d)?$',t): titles.append(t)
    return titles[:5]
def parse(s):
    for name,fn in (('nuxt-sidearm',nuxt_sidearm),('wmt',wmt),('classic',classic)):
        try: r=fn(s)
        except Exception as e: r=None
        if r: return name,r
    return None,[]
def arkansas(s):
    out=[]
    for m in re.finditer(r'<tr>\s*<td data-order="[^"]*"[^>]*>\s*<a href="https://arkansasrazorbacks.com/roster/[^"]+/">\s*([^<]+?)\s*</a>\s*</td>\s*<td>\s*([^<]*?)\s*</td>\s*<td>\s*([^<]*?)\s*</td>\s*<td>\s*([^<]*?)\s*</td>',s):
        nm=html.unescape(m.group(1)).strip(); p=nm.split(' ',1)
        out.append({'first':p[0],'last':p[1] if len(p)>1 else '','year':m.group(2),'hometown':html.unescape(m.group(3)),'prev':html.unescape(m.group(4)) or None})
    return out or None
def kentucky(s):
    out=[]
    i=s.find("Women's Gymnastics Players"); j=s.find('Coaches',i) if i>0 else -1
    seg=s[i:j if j>0 else None] if i>0 else s
    for m in re.finditer(r'<span itemprop="name" class="sr-only" content="([^"]+)"></span>.*?<p class="roster-item__info">(.*?)</p>',seg,re.S):
        nm=html.unescape(m.group(1)).strip(); p=nm.split(' ',1)
        info=clean(m.group(2)); yr=re.search(r'(Freshman|Sophomore|Junior|Senior|Graduate|Fifth[- ]Year|Redshirt \w+)',info)
        out.append({'first':p[0],'last':p[1] if len(p)>1 else '','year':yr.group(1) if yr else None,'hometown':None,'prev':None})
    return out or None
def sidearm_json(s):
    out=[];seen=set()
    for m in re.finditer(r'\{"rp_id":(\d+),"player_id":\d+,"roster_display_title":[^,]*,"first_name":"([^"]*)","last_name":"([^"]*)","hometown":("[^"]*"|null).*?"academic_year_short":("[^"]*"|null)',s):
        if m.group(1) in seen: continue
        seen.add(m.group(1))
        out.append({'first':json.loads('"'+m.group(2)+'"'),'last':json.loads('"'+m.group(3)+'"'),'year':json.loads(m.group(5)),'hometown':json.loads(m.group(4)),'prev':None})
    return out or None
_parse=parse
def parse(s):
    k,p=_parse(s)
    if p: return k,p
    for name,fn in (('arkansas',arkansas),('kentucky',kentucky),('sidearm-json',sidearm_json)):
        r=fn(s)
        if r: return name,r
    return None,[]
