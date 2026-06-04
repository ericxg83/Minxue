export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url') || ''

  if (!imageUrl) {
    return new Response('Missing url parameter', { status: 400 })
  }

  let parsedUrl
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    return new Response('Invalid URL', { status: 400 })
  }

  // Validate trusted domains - accept any OSS domain and render domain
  const hostname = parsedUrl.hostname
  const isTrusted = hostname.includes('aliyuncs.com') || hostname.includes('onrender.com')

  if (!isTrusted) {
    return new Response('Untrusted domain: ' + hostname, { status: 403 })
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
