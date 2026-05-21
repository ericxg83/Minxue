# Debug Session: fetch-fails-oss-cors
**Status:** `[OPEN]`  
**Created:** 2026-05-20  
**Bug:** 裁剪确认时报错：图片跨域限制导致无法导出

## 错误信息
```
裁剪失败: 图片跨域限制导致无法导出，请尝试使用本地图片
```

## 环境
- 部署平台: Cloudflare Pages (Pages.dev)
- 图片来源: OSS (Aliyun) - https://minxue-app-oss-oss-cn-shanghai.aliyuncs.com/

## 假说
- **H1:** `fetch()` 到 OSS URL 失败，OSS 不返回 CORS 头
- **H2:** Pages.dev 静态托管无后端代理，`/api/proxy-image` 不存在
- **H3:** 需要 Cloudflare Worker 作为图片代理

## Pre-fix Evidence
> Awaiting...

## Post-fix Evidence
> Pending...

## Conclusion
> Pending...
