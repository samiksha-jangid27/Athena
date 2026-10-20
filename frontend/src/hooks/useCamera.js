import { useCallback, useEffect, useRef, useState } from 'react'

// Owns the camera stream: start, live status, snapshots and cleanup.
export function useCamera() {
  const streamRef = useRef(null)
  const [stream, setStream] = useState(null)
  // idle | requesting | live | denied | lost | error
  const [status, setStatus] = useState('idle')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const start = useCallback(async () => {
    stop()
    setStatus('requesting')
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      const track = media.getVideoTracks()[0]
      track.addEventListener('ended', () => setStatus('lost'))
      track.addEventListener('mute', () => setStatus('lost'))
      track.addEventListener('unmute', () => setStatus('live'))
      streamRef.current = media
      setStream(media)
      setStatus('live')
      return true
    } catch (error) {
      setStatus(error?.name === 'NotAllowedError' ? 'denied' : 'error')
      return false
    }
  }, [stop])

  // Grabs one JPEG frame from the live stream.
  const snapshot = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || track.readyState !== 'live') return null
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = streamRef.current
    await video.play()
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    video.pause()
    video.srcObject = null
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }, [])

  useEffect(() => stop, [stop])

  return { stream, status, start, stop, snapshot }
}
