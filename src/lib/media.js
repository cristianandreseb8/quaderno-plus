export function compressImage(file, maxW = 1024, quality = 0.7) {
  return new Promise((res, rej) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.width * scale)
      cv.height = Math.round(img.height * scale)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      URL.revokeObjectURL(url)
      cv.toBlob((blob) => {
        if (!blob) { rej(new Error('Failed')); return }
        const rd = new FileReader()
        rd.onload = () => res({ media_type: 'image/jpeg', data: rd.result.split(',')[1], url: cv.toDataURL('image/jpeg', quality) })
        rd.onerror = rej
        rd.readAsDataURL(blob)
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Load failed')) }
    img.src = url
  })
}

export function compressThumbnail(file) {
  return new Promise((res, rej) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const s = Math.min(1, 400 / Math.max(img.width, img.height))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.width * s)
      cv.height = Math.round(img.height * s)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      URL.revokeObjectURL(url)
      cv.toBlob((blob) => {
        if (!blob) { rej(new Error('Failed')); return }
        const rd = new FileReader()
        rd.onload = () => res(rd.result)
        rd.onerror = rej
        rd.readAsDataURL(blob)
      }, 'image/jpeg', 0.45)
    }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Load failed')) }
    img.src = url
  })
}

export function loadImage(src) {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => res(null)
    img.src = src
  })
}

export function readFileAsBase64(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader()
    rd.onload = () => res(rd.result)
    rd.onerror = rej
    rd.readAsDataURL(file)
  })
}

export function parseMediaLibrary(raw) {
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}
