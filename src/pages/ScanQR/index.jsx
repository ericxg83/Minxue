import { useState, useRef } from 'react'
import {
  Button,
  Toast,
  NavBar,
  SpinLoading
} from 'antd-mobile'

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const fileInputRef = useRef(null)

  // 处理扫描
  const handleScan = () => {
    console.log('ScanQR: 开始扫描')
    setScanning(true)
    
    // 模拟扫描延迟
    setTimeout(() => {
      console.log('ScanQR: 扫描完成，准备回调')
      setScanning(false)
      
      // 模拟扫描数据
      const mockData = {
        paperId: 'paper_' + Date.now(),
        studentId: 'student-1',
        studentName: '张三',
        questionIds: ['wq-1', 'wq-2']
      }
      
      console.log('ScanQR: 调用 onScanSuccess:', mockData)
      
      // 调用父组件回调
      if (typeof onScanSuccess === 'function') {
        onScanSuccess(mockData)
      } else {
        console.error('ScanQR: onScanSuccess 不是函数!')
        Toast.show({ icon: 'fail', content: '系统错误' })
      }
    }, 1500)
  }

  // 从相册选择
  const handleAlbum = () => {
    fileInputRef.current?.click()
  }

  // 处理文件选择
  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      console.log('ScanQR: 从相册选择文件:', file.name)
      Toast.show({ icon: 'loading', content: '正在识别...' })
      
      // 模拟识别
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
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#000',
      zIndex: 2000
    }}>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 顶部导航 */}
      <NavBar
        back={null}
        style={{ background: 'transparent', color: '#fff' }}
        left={<Button fill="none" style={{ color: '#fff' }} onClick={onClose}>关闭</Button>}
      >
        <span style={{ color: '#fff' }}>扫码批改</span>
      </NavBar>

      {/* 扫描区域 */}
      <div style={{ 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}>
        {/* 扫描框 */}
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
          {/* 四角装饰 */}
          <div style={{ position: 'absolute', top: '-2px', left: '-2px', width: '30px', height: '30px', borderTop: '4px solid #1677ff', borderLeft: '4px solid #1677ff', borderRadius: '10px 0 0 0' }} />
          <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '30px', height: '30px', borderTop: '4px solid #1677ff', borderRight: '4px solid #1677ff', borderRadius: '0 10px 0 0' }} />
          <div style={{ position: 'absolute', bottom: '-2px', left: '-2px', width: '30px', height: '30px', borderBottom: '4px solid #1677ff', borderLeft: '4px solid #1677ff', borderRadius: '0 0 0 10px' }} />
          <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '30px', height: '30px', borderBottom: '4px solid #1677ff', borderRight: '4px solid #1677ff', borderRadius: '0 0 10px 0' }} />
          
          {/* 扫描线动画 */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '2px',
            background: 'linear-gradient(90deg, transparent, #1677ff, transparent)',
            animation: 'scan 2s linear infinite'
          }} />

          {scanning ? (
            <SpinLoading style={{ '--size': '48px', color: '#1677ff' }} />
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', textAlign: 'center' }}>
              点击扫描
            </div>
          )}
        </div>

        {/* 提示文字 */}
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginTop: '30px', textAlign: 'center' }}>
          将二维码放入框内，自动识别
        </div>
      </div>

      {/* 底部按钮 */}
      <div style={{ 
        padding: '30px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div 
          onClick={handleAlbum}
          style={{ textAlign: 'center', color: '#fff', cursor: 'pointer' }}
        >
          <div style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '8px'
          }}>
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128zM512 832c-88 0-160-72-160-160s72-160 160-160 160 72 160 160-72 160-160 160zm0-256c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z"/>
            </svg>
          </div>
          <div style={{ fontSize: '12px' }}>相册</div>
        </div>
        
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ 
            width: '64px', 
            height: '64px', 
            borderRadius: '50%',
            border: '4px solid #fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          onClick={handleScan}
          >
            <div style={{ 
              width: '52px', 
              height: '52px', 
              borderRadius: '50%',
              background: scanning ? '#1677ff' : '#fff'
            }} />
          </div>
        </div>
        
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '8px'
          }}>
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M512 128c-211.2 0-384 172.8-384 384s172.8 384 384 384 384-172.8 384-384-172.8-384-384-384z m0 704c-176.8 0-320-143.2-320-320s143.2-320 320-320 320 143.2 320 320-143.2 320-320 320z"/>
              <path d="M512 320c-17.6 0-32 14.4-32 32v160c0 17.6 14.4 32 32 32s32-14.4 32-32V352c0-17.6-14.4-32-32-32z"/>
              <path d="M512 544c-17.6 0-32 14.4-32 32s14.4 32 32 32 32-14.4 32-32-14.4-32-32-32z"/>
            </svg>
          </div>
          <div style={{ fontSize: '12px' }}>历史</div>
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 0; }
          50% { top: 100%; }
          100% { top: 0; }
        }
      `}</style>
    </div>
  )
}
