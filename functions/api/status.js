/**
 * EdgeOne Pages Function：服务状态（供页面顶栏/左下角显示）
 * 路由：GET /api/status
 */
export async function onRequest(context) {
  const env = (context && context.env) || {};
  const configured = Boolean(env.WEBHOOK_URL && env.AIRSCRIPT_TOKEN);
  return new Response(JSON.stringify({ mock: false, configured }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
