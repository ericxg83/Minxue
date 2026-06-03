export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  const imageUrl = decodeURIComponent(url.searchParams.get('url') || '')

  if (!imageUrl) {
    return new Response('Missing url parameter', { status: 400 })
  }

  // Validate trusted domains
  const trustedDomains = [
    'minxue-app-oss-oss-cn-shanghai.aliyuncs.com',
    'minxue-api.onrender.com'
  ]

  try {
    const parsedUrl = new URL(imageUrl)
    if (!trustedDomains.some(d => parsedUrl.hostname.includes(d))) {
      return new Response('Untrusted domain', { status: 403 })
    }
  } catch {
    return new Response('Invalid URL', { status: 400 })
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'Referer': 'https://minxue.pages.dev'
      }
    })

    if (!response.ok) {
      return new Response(`Image fetch failed: ${response.status}`, {
        status: response.status,
        headers: { 'Content-Type': 'text/plain' }
      })
    }

    const body = await response.arrayBuffer()
    const contentType = response.headers.get('Content-Type') || 'image/jpeg'

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (error) {
    console.error('Proxy error:', error)
    return new Response(`Proxy error: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}
