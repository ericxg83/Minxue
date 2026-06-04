const API_BASE = 'https://minxue-api.onrender.com/api'

export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  
  // Reconstruct the API path (remove /api/ prefix and append to API_BASE)
  const apiPath = url.pathname.replace(/^\/api/, '')
  const targetUrl = API_BASE + apiPath + url.search

  try {
    // Clone request headers, removing host-related headers
    const headers = new Headers(request.headers)
    headers.set('Host', new URL(API_BASE).host)

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : undefined
    })

    // Clone response and update CORS headers
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    })
  } catch (error) {
    return new Response(`API proxy error: ${error.message}`, { status: 502 })
  }
}
