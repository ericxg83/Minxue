package com.minxue.app;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
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
