import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Camera, Image as ImageIcon, Clock, QrCode } from 'lucide-react'
import { useWrongQuestionStore, useStudentStore } from '../../store'

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const fileInputRef = useRef(null)
  const { wrongQuestions } = useWrongQuestionStore()
  const { currentStudent } = useStudentStore()

  const handleScan = () => {
    setScanning(true)
    
    setTimeout(() => {
      setScanning(false)
      
      const pendingQuestions = wrongQuestions.filter(wq => 
        wq.student_id === currentStudent?.id && wq.status !== 'mastered'
      )
      
      const questionIds = pendingQuestions.slice(0, 5).map(wq => wq.id)
      
      const mockData = {
        paperId: 'paper_' + Date.now(),
        studentId: currentStudent?.id,
        studentName: currentStudent?.name,
        questionIds: questionIds
      }
      
      onScanSuccess(mockData)
    }, 1500)
  }

  const handleAlbum = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setTimeout(() => {
        const pendingQuestions = wrongQuestions.filter(wq => 
          wq.student_id === currentStudent?.id && wq.status !== 'mastered'
        )
        
        const questionIds = pendingQuestions.slice(0, 5).map(wq => wq.id)
        
        const mockData = {
          paperId: 'paper_' + Date.now(),
          studentId: currentStudent?.id,
          studentName: currentStudent?.name,
          questionIds: questionIds
        }
        
        onScanSuccess(mockData)
      }, 1000)
    }
  }

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column'
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '48px 16px 12px'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '4px',
              borderRadius: '50%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <X size={22} color="#fff" />
          </button>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#fff' }}>扫码批改</h2>
          <div style={{ width: '36px' }} />
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          <div 
            onClick={handleScan}
            style={{
              width: '280px',
              height: '280px',
              border: '2px solid rgba(255,255,255,0.5)',
              borderRadius: '20px',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-2px',
              left: '-2px',
              width: '30px',
              height: '30px',
              borderTop: '4px solid #2563EB',
              borderLeft: '4px solid #2563EB',
              borderTopLeftRadius: '10px'
            }} />
            <div style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '30px',
              height: '30px',
              borderTop: '4px solid #2563EB',
              borderRight: '4px solid #2563EB',
              borderTopRightRadius: '10px'
            }} />
            <div style={{
              position: 'absolute',
              bottom: '-2px',
              left: '-2px',
              width: '30px',
              height: '30px',
              borderBottom: '4px solid #2563EB',
              borderLeft: '4px solid #2563EB',
              borderBottomLeftRadius: '10px'
            }} />
            <div style={{
              position: 'absolute',
              bottom: '-2px',
              right: '-2px',
              width: '30px',
              height: '30px',
              borderBottom: '4px solid #2563EB',
              borderRight: '4px solid #2563EB',
              borderBottomRightRadius: '10px'
            }} />
            
            <motion.div
              animate={{ top: ['0%', '100%', '0%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '2px',
                background: 'linear-gradient(to right, transparent, #2563EB, transparent)'
              }}
            />

            {scanning ? (
              <Loader2 size={48} color="#2563EB" className="animate-spin" />
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', textAlign: 'center' }}>
                点击扫描
              </div>
            )}
          </div>

          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginTop: '32px', textAlign: 'center' }}>
            将二维码放入框内，自动识别
          </div>
        </div>

        <div style={{
          padding: '0 40px 48px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div onClick={handleAlbum} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '8px',
              margin: '0 auto 8px'
            }}>
              <ImageIcon size={24} color="#fff" />
            </div>
            <div style={{ color: '#fff', fontSize: '12px' }}>相册</div>
          </div>
          
          <div 
            onClick={handleScan}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              border: '4px solid #fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              transition: 'background-color 0.2s',
              background: scanning ? '#2563EB' : '#fff'
            }} />
          </div>
          
          <div style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '8px',
              margin: '0 auto 8px'
            }}>
              <Clock size={24} color="#fff" />
            </div>
            <div style={{ color: '#fff', fontSize: '12px' }}>历史</div>
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}
