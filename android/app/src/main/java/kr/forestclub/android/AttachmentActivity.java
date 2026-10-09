package kr.forestclub.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;

public final class AttachmentActivity extends Activity {
    private PdfRenderer pdf;
    private ParcelFileDescriptor descriptor;
    private ImageView image;
    private TextView status;
    private Bitmap displayed;
    private int page;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(16, 32, 16, 24); root.setFitsSystemWindows(true); root.setBackgroundColor(Color.WHITE);
        Button close = new Button(this); close.setText("닫기"); close.setOnClickListener(v -> finish()); root.addView(close);
        status = new TextView(this); status.setTextSize(16); root.addView(status); image = new ImageView(this); image.setAdjustViewBounds(true); image.setScaleType(ImageView.ScaleType.FIT_CENTER); root.addView(image, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        try {
            File file = new File(getIntent().getStringExtra("file")); File folder = new File(getCacheDir(), "attachments");
            if (!file.getCanonicalPath().startsWith(folder.getCanonicalPath() + File.separator)) throw new Exception("잘못된 파일 주소");
            if ("application/pdf".equals(getIntent().getStringExtra("mime"))) {
                descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY); pdf = new PdfRenderer(descriptor);
                LinearLayout navigation = new LinearLayout(this); Button previous = new Button(this), next = new Button(this); previous.setText("이전 페이지"); next.setText("다음 페이지");
                previous.setOnClickListener(v -> { if (page > 0) { page--; drawPage(); } }); next.setOnClickListener(v -> { if (page + 1 < pdf.getPageCount()) { page++; drawPage(); } });
                navigation.addView(previous, new LinearLayout.LayoutParams(0, -2, 1)); navigation.addView(next, new LinearLayout.LayoutParams(0, -2, 1)); root.addView(navigation); drawPage();
            } else {
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeFile(file.getPath(), options); options.inSampleSize = 1;
                while (options.outWidth / options.inSampleSize > 1920 || options.outHeight / options.inSampleSize > 1920) options.inSampleSize *= 2;
                options.inJustDecodeBounds = false; displayed = BitmapFactory.decodeFile(file.getPath(), options); if (displayed == null) throw new Exception("사진을 열 수 없습니다."); image.setImageBitmap(displayed); status.setText("사진 미리보기");
            }
        } catch (Exception e) { new AlertDialog.Builder(this).setMessage("첨부파일을 열지 못했습니다.").setPositiveButton("확인", (d, w) -> finish()).show(); }
    }
    private void drawPage() {
        if (displayed != null) { image.setImageDrawable(null); displayed.recycle(); }
        try (PdfRenderer.Page document = pdf.openPage(page)) {
            int width = Math.min(1600, Math.max(480, getResources().getDisplayMetrics().widthPixels)); int height = Math.max(1, (int) ((double) document.getHeight() / document.getWidth() * width));
            if (height > 6000) { width = Math.max(1, width * 6000 / height); height = 6000; }
            displayed = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888); displayed.eraseColor(Color.WHITE); document.render(displayed, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            image.setImageBitmap(displayed); status.setText((page + 1) + " / " + pdf.getPageCount() + " 페이지");
        }
    }
    @Override protected void onDestroy() {
        if (pdf != null) pdf.close(); try { if (descriptor != null) descriptor.close(); } catch (Exception ignored) { }
        if (displayed != null) displayed.recycle(); super.onDestroy();
    }
}
