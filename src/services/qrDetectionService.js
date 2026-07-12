// QR Code detection service
export const detectQRCode = async (imageFile) => {
  try {
    // Convert file to base64 for QR code detection
    const base64 = await fileToBase64(imageFile)

    // Using a simple QR code detection approach
    // In a real implementation, you might use a library like jsqr or qr-scanner
    const result = await detectQRCodeBase64(base64)

    return result
  } catch (error) {
    console.debug('QR detection failed:', error)
    return null
  }
}

// Convert file to base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = error => reject(error)
    reader.readAsDataURL(file)
  })
}

// Simple QR code detection - in production, replace with a proper QR detection library
const detectQRCodeBase64 = async (base64) => {
  return new Promise((resolve) => {
    try {
      // Create an image element to load the base64 data
      const img = new Image()
      img.onload = () => {
        // Create a canvas to draw the image
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        // Set canvas dimensions to match image
        canvas.width = img.width
        canvas.height = img.height

        // Draw image on canvas
        ctx.drawImage(img, 0, 0)

        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

        // Simple QR pattern detection - this is a simplified version
        // In production, use a proper QR code detection library like jsQR
        const qrPatterns = [
          'retry_', 'paper_', 'grading_', 'exam_', 'task_'
        ]

        // Check for QR codes by looking for common patterns in the image
        // This is a placeholder - actual QR detection requires specialized libraries
        let detectedQR = null

        // For demo purposes, let's simulate QR detection based on file name patterns
        if (base64.length > 1000) {
          // Simulate detecting QR codes that contain specific patterns
          qrPatterns.forEach(pattern => {
            if (base64.indexOf(pattern) > -1) {
              detectedQR = pattern + Date.now().toString(36)
            }
          })
        }

        // If no QR pattern found, check for common QR code locations
        if (!detectedQR && imageData.data.length > 0) {
          // Check corners for QR code patterns (simplified)
          const corners = [
            { x: 0, y: 0 },
            { x: canvas.width - 10, y: 0 },
            { x: 0, y: canvas.height - 10 },
            { x: canvas.width - 10, y: canvas.height - 10 }
          ]

          for (const corner of corners) {
            const pixelIndex = (corner.y * canvas.width + corner.x) * 4
            if (pixelIndex < imageData.data.length) {
              const brightness = (imageData.data[pixelIndex] + imageData.data[pixelIndex + 1] + imageData.data[pixelIndex + 2]) / 3
              if (brightness < 128) { // Dark pixel potential QR marker
                detectedQR = `detected_${Date.now()}`
                break
              }
            }
          }
        }

        resolve(detectedQR)
      }

      img.onerror = () => {
        resolve(null)
      }

      img.src = base64
    } catch (error) {
      console.debug('QR detection error:', error)
      resolve(null)
    }
  })
}

// Group files by QR code content
export const groupFilesByQRCode = (filesWithQR) => {
  const groups = new Map()

  filesWithQR.forEach(({ file, qrContent }) => {
    if (!qrContent) {
      // No QR code, create individual group
      const key = `no_qr_${Date.now()}_${Math.random()}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push({ file, qrContent: null })
    } else {
      // Has QR code, group by QR content
      if (!groups.has(qrContent)) {
        groups.set(qrContent, [])
      }
      groups.get(qrContent).push({ file, qrContent })
    }
  })

  return Array.from(groups.entries()).map(([qrContent, files]) => ({
    qrContent,
    files: files.map(f => f.file),
    isRetryPaper: !!qrContent
  }))
}