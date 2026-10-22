const http=require('http'),fs=require('fs'),path=require('path');
const crypto=require('crypto');const root=__dirname,dataDir=process.env.DATA_DIR||path.join(root,'data'),store=path.join(dataDir,'catalog.json');
fs.mkdirSync(dataDir,{recursive:true});if(!fs.existsSync(store))fs.copyFileSync(path.join(root,'seed','catalog.json'),store);
const pool=process.env.DATABASE_URL?new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10000}):null;
async function readCatalog(){if(!pool)return JSON.parse(fs.readFileSync(store,'utf8'));const r=await pool.query('SELECT payload FROM catalog_state WHERE id=1');return r.rows[0].payload}
async function saveCatalog(data){if(!pool){fs.copyFileSync(store,store+'.backup');fs.writeFileSync(store+'.tmp',JSON.stringify(data,null,2));fs.renameSync(store+'.tmp',store);return}await pool.query('UPDATE catalog_state SET previous=payload, payload=$1::jsonb, updated_at=now() WHERE id=1',[JSON.stringify(data)])}
async function initialize(){if(!pool)return;await pool.query('CREATE TABLE IF NOT EXISTS catalog_state (id integer PRIMARY KEY CHECK (id=1),payload jsonb NOT NULL,previous jsonb,updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('INSERT INTO catalog_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING',[fs.readFileSync(store,'utf8')])}
const cloud=!!(process.env.RENDER||process.env.RAILWAY_ENVIRONMENT_ID),password=process.env.ADMIN_PASSWORD;
if(cloud&&!password)throw Error('Set ADMIN_PASSWORD before starting the hosted website.');
function allowed(req){if(!password)return true;const header=req.headers.authorization||'';if(!header.startsWith('Basic '))return false;const actual=Buffer.from(header.slice(6),'base64').toString();const expected='admin:'+password;const a=crypto.createHash('sha256').update(actual).digest(),b=crypto.createHash('sha256').update(expected).digest();return crypto.timingSafeEqual(a,b)}

function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health'){if(pool)await pool.query('SELECT 1');return json(res,200,{ok:true})}
 if(!allowed(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Watch gallery", charset="UTF-8"','Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.end('请使用管理员账号和密码登录。');}

 if(req.headers.origin&&!['http://','https://'].some(protocol=>req.headers.origin===protocol+req.headers.host))return json(res,403,{error:'Origin rejected'});
 if(url.pathname==='/api/catalog'){
  if(req.method==='GET')return json(res,200,await readCatalog());
  if(req.method==='PUT'){if(cloud&&!pool)return json(res,503,{error:'请先连接在线数据库，再保存商品。'});
   if(req.headers['x-catalog-editor']!=='1')return json(res,403,{error:'Editor header required'});
   let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>45*1024*1024)return json(res,413,{error:'图片总量过大，请压缩后再试'});chunks.push(chunk)}
   const data=JSON.parse(Buffer.concat(chunks).toString());
   if(!Array.isArray(data.brands)||!Array.isArray(data.products)||data.products.length>200)return json(res,400,{error:'商品数据不正确'});
   const ids=new Set();for(const p of data.products){if(ids.has(p.id)||!data.brands.includes(p.brand)||typeof p.name!=='string'||!Array.isArray(p.images)||p.images.length>6||p.images.some(x=>typeof x!=='string'||!(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x)||/^https:\/\/(media\.rolex\.com|patek-res\.cloudinary\.com)\//.test(x))))return json(res,400,{error:'商品或图片格式不正确'});ids.add(p.id)}
   await saveCatalog(data);return json(res,200,{ok:true});
  }return json(res,405,{error:'Method not allowed'});
 }
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
 if(/^\/product\/\d+$/.test(url.pathname)){const id=Number(url.pathname.split('/')[2]);const data=await readCatalog();if(!data.products.some(p=>p.id===id))return json(res,404,{error:'商品不存在'});}
 const file=(url.pathname==='/'||/^\/product\/\d+$/.test(url.pathname))?'index.html':url.pathname==='/admin'?'admin.html':null;
 if(!file)return json(res,404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(root,'public',file)));
 }catch(e){json(res,400,{error:'保存或读取失败，请检查内容后重试'})}});
const port=Number(process.env.PORT||8787);initialize().then(()=>server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Front: http://127.0.0.1:${port}\nAdmin: http://127.0.0.1:${port}/admin\nKeep this window open. Ctrl+C to stop.`))).catch(e=>{console.error('Database initialization failed:',e.message);process.exitCode=1});
