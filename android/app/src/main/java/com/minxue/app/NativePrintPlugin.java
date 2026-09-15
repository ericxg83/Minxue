package com.minxue.app;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    // 打印中的 WebView 必须持有引用，否则 GC 回收会导致打印任务中断
    private WebView pendingPrintWebView;

    @PluginMethod
    public void printPdf(PluginCall call) {
        String base64 = call.getString("data", "");
        String title = call.getString("title", "敏学试卷");
        if (base64 == null || base64.isEmpty()) {
            call.reject("PDF 内容为空");
            return;
        }

        try {
            byte[] pdfBytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            File file = new File(getContext().getCacheDir(), "minxue-print.pdf");
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(pdfBytes);
            }

            PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                call.reject("系统打印服务不可用");
                return;
            }

            printManager.print(title, new PdfPrintAdapter(file), new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build());

            JSObject result = new JSObject();
            result.put("printed", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("打开系统打印失败: " + error.getMessage(), error);
        }
    }

    /**
     * 直接打印已渲染好的卷面 HTML（2026-09-15 新增）。
     *
     * 为什么不再走 printPdf（JS 层传 blob）：几 MB 的 PDF 转 base64 后走
     * Capacitor 桥传给原生，在部分手机 WebView 上会静默失败/长时间卡死——
     * 这正是「网页能打印、App 里两个按钮都没反应」的根因。
     *
     * 本方法在原生侧自建离屏 WebView 加载 HTML（KaTeX 字体已 data-URL 内联，
     * 不依赖网络；配图为 https 绝对地址可正常加载），等图片加载完成后交给
     * 系统 PrintManager 打印。打印对话框里用户也可选「另存为 PDF」。
     *
     * 794px ≈ 210mm @96dpi，配合 NO_MARGINS 恰好铺满 A4。
     */
    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html", "");
        final String title = call.getString("title", "敏学试卷");
        if (html == null || html.isEmpty()) {
            call.reject("HTML 内容为空");
            return;
        }

        final PrintManager printManager =
            (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
        if (printManager == null) {
            call.reject("系统打印服务不可用");
            return;
        }

        try {
            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        WebView webView = new WebView(getContext());
                        pendingPrintWebView = webView;
                        webView.getSettings().setJavaScriptEnabled(true);
                        // 配图是 https 绝对地址（OSS），必须允许网络图片
                        webView.getSettings().setBlockNetworkImage(false);
                        webView.getSettings().setLoadsImagesAutomatically(true);
                        webView.getSettings().setDomStorageEnabled(true);

                        webView.setWebViewClient(new WebViewClient() {
                            private boolean triggered = false;

                            @Override
                            public void onPageFinished(WebView view, String url) {
                                if (triggered) return;
                                triggered = true;
                                waitForImagesThenPrint(view, printManager, title, call);
                            }
                        });

                        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
                    } catch (Exception e) {
                        pendingPrintWebView = null;
                        call.reject("加载打印内容失败: " + e.getMessage(), e);
                    }
                }
            });
        } catch (Exception error) {
            call.reject("打开系统打印失败: " + error.getMessage(), error);
        }
    }

    /**
     * 轮询页面图片是否全部加载完成（最多 10 秒），避免配图缺页。
     * HTML 内的 KaTeX 已在上层渲染完毕（纯静态 DOM + data-URL 字体），无需等待脚本。
     */
    private void waitForImagesThenPrint(final WebView view, final PrintManager printManager,
                                        final String title, final PluginCall call) {
        final long[] attempts = {0};
        final Runnable[] poll = new Runnable[1];
        poll[0] = new Runnable() {
            @Override
            public void run() {
                attempts[0]++;
                view.evaluateJavascript(
                    "(function(){var imgs=document.images;for(var i=0;i<imgs.length;i++){if(!imgs[i].complete)return 'pending';}return 'done';})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            boolean ready = value != null && value.contains("done");
                            if (ready || attempts[0] >= 20) { // 20 × 500ms = 10s 上限
                                startPrint(view, printManager, title, call);
                            } else {
                                view.postDelayed(poll[0], 500);
                            }
                        }
                    });
            }
        };
        // onPageFinished 后至少给 800ms 的排版/字体稳定时间
        view.postDelayed(poll[0], 800);
    }

    private void startPrint(WebView view, PrintManager printManager, String title, PluginCall call) {
        try {
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(title);
            printManager.print(title, adapter, new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build());
            JSObject result = new JSObject();
            result.put("printed", true);
            call.resolve(result);
        } catch (Exception error) {
            pendingPrintWebView = null;
            call.reject("打开系统打印失败: " + error.getMessage(), error);
        }
    }

    private static class PdfPrintAdapter extends PrintDocumentAdapter {
        private final File file;

        PdfPrintAdapter(File file) {
            this.file = file;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                             CancellationSignal cancellationSignal, LayoutResultCallback callback,
                             Bundle extras) {
            if (cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder("minxue-print.pdf")
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(PageRange[] pages, android.os.ParcelFileDescriptor destination,
                            CancellationSignal cancellationSignal, WriteResultCallback callback) {
            try (java.io.InputStream input = new FileInputStream(file);
                 java.io.OutputStream output = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    output.write(buffer, 0, count);
                }
                output.flush();
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (IOException error) {
                callback.onWriteFailed(error.getMessage());
            }
        }
    }
}
