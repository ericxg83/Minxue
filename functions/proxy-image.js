export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url')

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

  const response = await fetch(imageUrl)

  return new Response(response.body, {
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    },
    status: response.status
  })
}
