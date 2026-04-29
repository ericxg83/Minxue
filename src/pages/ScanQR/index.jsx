import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Camera, Image as ImageIcon, Clock, QrCode } from 'lucide-react'

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const fileInputRef = useRef(null)

  const handleScan = () => {
    console.log('ScanQR: 开始扫描')
    setScanning(true)
    
    setTimeout(() => {
      console.log('ScanQR: 扫描完成，准备回调')
      setScanning(false)
      
      const mockData = {
        paperId: 'paper_' + Date.now(),
        studentId: 'student-1',
        studentName: '张三',
        questionIds: ['wq-1', 'wq-2']
      }
      
      console.log('ScanQR: 调用 onScanSuccess:', mockData)
      
      if (typeof onScanSuccess === 'function') {
        onScanSuccess(mockData)
      } else {
        console.error('ScanQR: onScanSuccess 不是函数!')
      }
    }, 1500)
  }

  const handleAlbum = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      console.log('ScanQR: 从相册选择文件:', file.name)
      
      setTimeout(() => {
        const mockData = {
          paperId: 'paper_' + Date.now(),
          studentId: 'student-1',
          studentName: '张三',
          questionIds: ['wq-1', 'wq-2']
        }
        
        console.log('ScanQR: 相册识别完成，调用回调:', mockData)
        if (typeof onScanSuccess === 'function') {
          onScanSuccess(mockData)
        }
      }, 1000)
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black z-[10000] flex flex-col">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-12 pb-4">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <X size={24} className="text-white" />
          </button>
          <h2 className="text-[17px] font-bold text-white">扫码批改</h2>
          <div className="w-10" />
        </div>

        {/* Scan Area */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div 
            onClick={handleScan}
            className="w-[280px] h-[280px] border-2 border-white/50 rounded-[20px] relative flex items-center justify-center cursor-pointer"
          >
            {/* Corner Decorations */}
            <div className="absolute top-[-2px] left-[-2px] w-[30px] h-[30px] border-t-4 border-l-4 border-blue-500 rounded-tl-[10px]" />
            <div className="absolute top-[-2px] right-[-2px] w-[30px] h-[30px] border-t-4 border-r-4 border-blue-500 rounded-tr-[10px]" />
            <div className="absolute bottom-[-2px] left-[-2px] w-[30px] h-[30px] border-b-4 border-l-4 border-blue-500 rounded-bl-[10px]" />
            <div className="absolute bottom-[-2px] right-[-2px] w-[30px] h-[30px] border-b-4 border-r-4 border-blue-500 rounded-br-[10px]" />
            
            {/* Scan Line Animation */}
            <motion.div
              animate={{ top: ['0%', '100%', '0%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent"
            />

            {scanning ? (
              <Loader2 size={48} className="text-blue-500 animate-spin" />
            ) : (
              <div className="text-white/60 text-[14px] text-center">点击扫描</div>
            )}
          </div>

          <div className="text-white/80 text-[14px] mt-8 text-center">
            将二维码放入框内，自动识别
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="px-10 pb-12 flex justify-between items-center">
          <div onClick={handleAlbum} className="text-center cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-2 mx-auto">
              <ImageIcon size={24} className="text-white" />
            </div>
            <div className="text-white text-[12px]">相册</div>
          </div>
          
          <div 
            onClick={handleScan}
            className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center cursor-pointer"
          >
            <div className={`w-[52px] h-[52px] rounded-full transition-colors ${scanning ? 'bg-blue-500' : 'bg-white'}`} />
          </div>
          
          <div className="text-center cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-2 mx-auto">
              <Clock size={24} className="text-white" />
            </div>
            <div className="text-white text-[12px]">历史</div>
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}
