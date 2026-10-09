package kr.forestclub.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 보이스톡·페이스톡 통화 화면. 음성·영상 연결과 영상 표시는 뒤쪽 웹뷰의 ForestCall.html(Daily.co)이, 버튼과 과금은 이 화면이 맡는다. */
public final class CallActivity extends Activity {
    static final String EXTRA_ROOM = "room", EXTRA_KIND = "kind", EXTRA_NAME = "name", EXTRA_MESSAGE = "message";
    /** MainActivity가 로그인한 같은 ApiClient로 과금 요청을 보낸다. */
    static volatile ApiClient api;
    static volatile boolean inCall;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebView web;
    private TextView status, cost;
    private Button mute, camera, flip, end;
    private CallPolicy.Kind kind;
    private String room, server;
    private long startedAt;
    private boolean pageLoaded, muted, cameraOff, ended, closed, hasPartner;
    private String endMessage;
    private int previousAudioMode = AudioManager.MODE_NORMAL;
    private boolean previousSpeaker;
    private final Runnable billing = new Runnable() { public void run() { tick(); main.postDelayed(this, 1000); } };
    private final Runnable clock = new Runnable() { public void run() { updateStatus(); main.postDelayed(this, 1000); } };
    private final Runnable ringTimeout = () -> { if (!hasPartner) finishCall("상대방이 통화에 들어오지 않아 연결을 종료했어요."); };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        room = CallPolicy.roomUrl(String.valueOf(getIntent().getStringExtra(EXTRA_ROOM)));
        kind = CallPolicy.Kind.of(getIntent().getStringExtra(EXTRA_KIND));
        ApiClient client = api; server = client == null ? "" : client.server();
        boolean permitted = true; for (String permission : kind.permissions()) permitted &= checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
        if (room == null || server.isEmpty() || !permitted) { setResult(RESULT_OK, new Intent().putExtra(EXTRA_MESSAGE, "통화를 시작하지 못했습니다.")); finish(); return; }
        inCall = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        previousAudioMode = audio.getMode(); audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        // 페이스톡은 화면을 보며 통화하므로 수화기 대신 스피커로 듣는다.
        previousSpeaker = audio.isSpeakerphoneOn(); if (CallPolicy.Kind.of(getIntent().getStringExtra(EXTRA_KIND)) == CallPolicy.Kind.VIDEO) audio.setSpeakerphoneOn(true);

        boolean video = kind == CallPolicy.Kind.VIDEO;
        // 영상은 화면 전체에 깔리는 웹뷰가 그리고, 이름·상태·버튼은 그 위에 겹쳐 표시한다.
        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(video ? Color.BLACK : MainActivity.GREEN);
        LinearLayout overlay = new LinearLayout(this); overlay.setOrientation(LinearLayout.VERTICAL); overlay.setGravity(Gravity.CENTER_HORIZONTAL);
        overlay.setFitsSystemWindows(true); overlay.setPadding(dp(20), dp(video ? 16 : 80), dp(20), dp(24));
        String partner = getIntent().getStringExtra(EXTRA_NAME);
        TextView name = label(partner == null || partner.isEmpty() ? kind.title : partner, video ? 24 : 30); name.setTypeface(null, Typeface.BOLD); overlay.addView(name);
        status = label(kind.title + " 연결하는 중…", video ? 16 : 19); overlay.addView(status);
        cost = label("통화 중 초당 " + CallPolicy.coins(kind.costPerSecond) + "코인 사용", 14); overlay.addView(cost);
        overlay.addView(new android.view.View(this), new LinearLayout.LayoutParams(-1, 0, 1));
        int dim = video ? Color.argb(115, 0, 0, 0) : Color.argb(46, 255, 255, 255);
        LinearLayout controls = new LinearLayout(this);
        mute = action("음소거", dim, () -> { muted = !muted; mute.setText(muted ? "소리 켜기" : "음소거"); script("forestMute(" + muted + ")"); });
        camera = action("화면 끄기", dim, () -> { cameraOff = !cameraOff; camera.setText(cameraOff ? "화면 켜기" : "화면 끄기"); script("forestCamera(" + !cameraOff + ")"); });
        flip = action("카메라 전환", dim, () -> script("forestFlip()"));
        for (Button button : video ? new Button[]{mute, camera, flip} : new Button[]{mute}) {
            button.setEnabled(false); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(52), 1); params.setMarginStart(dp(5)); params.setMarginEnd(dp(5)); controls.addView(button, params);
        }
        overlay.addView(controls, new LinearLayout.LayoutParams(-1, -2));
        end = action("통화 종료", Color.rgb(217, 51, 51), () -> finishCall(null)); overlay.addView(end, actionParams());

        web = new WebView(this); web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setMediaPlaybackRequiresUserGesture(false); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(), "ForestCall");
        web.setWebViewClient(new WebViewClient() {
            // 처음 불러온 통화 페이지 외의 화면 이동은 막는다.
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public void onPageFinished(WebView view, String url) { pageLoaded = true; }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) finishCall("통화 화면을 불러오지 못했습니다."); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // 앱이 이미 권한을 받았으므로 통화 페이지의 요청을 허용한다. 카메라는 페이스톡에서만 쓴다.
            @Override public void onPermissionRequest(PermissionRequest request) {
                Uri origin = request.getOrigin(); boolean allowed = request.getResources().length > 0;
                for (String resource : request.getResources()) allowed &= PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) || (video && PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource));
                if (allowed && origin != null && Uri.parse(server).getHost().equals(origin.getHost())) request.grant(request.getResources()); else request.deny();
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1)); root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        main.postDelayed(ringTimeout, CallPolicy.RING_MILLIS);
        try (InputStream page = getAssets().open("ForestCall.html")) {
            // 마이크·카메라는 보안 출처(HTTPS)에서만 열리므로 포레스트클럽 서버 주소를 페이지 출처로 사용한다.
            web.loadDataWithBaseURL(server + "/", new String(ApiClient.readLimited(page, 1024 * 1024), StandardCharsets.UTF_8), "text/html", "utf-8", null);
        } catch (Exception e) { finishCall("통화 화면을 준비하지 못했습니다."); }
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(Color.WHITE); view.setGravity(Gravity.CENTER); view.setPadding(0, dp(6), 0, dp(6)); view.setShadowLayer(dp(3), 0, 0, Color.argb(200, 0, 0, 0)); return view; }
    private Button action(String title, int color, Runnable run) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false); button.setTextSize(18); button.setTextColor(Color.WHITE);
        GradientDrawable background = new GradientDrawable(); background.setColor(color); background.setCornerRadius(dp(28)); button.setBackground(background);
        button.setOnClickListener(v -> run.run()); return button;
    }
    private LinearLayout.LayoutParams actionParams() { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(56)); params.topMargin = dp(14); return params; }
    private void script(String code) { if (web != null && pageLoaded) web.evaluateJavascript(code, null); }

    private final class Bridge {
        @JavascriptInterface public void post(String text) { main.post(() -> handle(text)); }
    }
    private void handle(String text) {
        JSONObject event; try { event = new JSONObject(text); } catch (Exception e) { return; }
        int remote = event.optInt("remote");
        switch (event.optString("type")) {
            case "ready": if (!ended) web.evaluateJavascript("forestJoin(" + new JSONArray().put(room) + "[0], '" + kind.value + "')", null); break;
            case "joined":
                if (ended) return;
                startedAt = System.currentTimeMillis(); mute.setEnabled(true); camera.setEnabled(true); flip.setEnabled(true);
                main.postDelayed(billing, 1000); main.postDelayed(clock, 1000); partnersChanged(remote); break;
            case "participants": partnersChanged(remote); break;
            case "left": finishCall(null); break;
            case "error": finishCall(event.optString("message", "통화 중 오류가 발생했어요")); break;
            case "closed": close(); break;
            default: break;
        }
    }
    private void partnersChanged(int remote) {
        if (ended) return;
        if (remote > 0) { hasPartner = true; main.removeCallbacks(ringTimeout); }
        else if (hasPartner) { finishCall("상대방이 통화를 종료했어요."); return; }
        updateStatus();
    }
    private void updateStatus() {
        if (ended || startedAt == 0) return;
        long seconds = (System.currentTimeMillis() - startedAt) / 1000;
        status.setText(hasPartner ? String.format(Locale.ROOT, "통화 중 %02d:%02d", seconds / 60, seconds % 60) : "상대방이 받기를 기다리는 중…");
    }
    /** 웹 버전과 같이 통화방에 들어간 뒤 1초마다 차감하고, 잔액이 유지 기준 이하이거나 차감에 실패하면 종료한다. */
    private void tick() {
        ApiClient client = api; if (client == null) { finishCall("로그인이 필요합니다."); return; }
        io.execute(() -> {
            try {
                JSONObject result = (JSONObject) client.post(new JSONObject().put("callType", kind.value).put("roomUrl", room), "api", "calls", "tick");
                main.post(() -> {
                    if (ended) return;
                    if (result.has("coins")) cost.setText("초당 " + CallPolicy.coins(kind.costPerSecond) + "코인 사용 중 · 보유 " + CallPolicy.coins(result.optLong("coins")) + "코인");
                    if (result.optBoolean("shouldEnd")) finishCall("코인이 " + CallPolicy.coins(result.optLong("continueMin", 1500)) + "개 이하로 떨어져 통화를 종료해요. 충전 후 다시 이용해주세요.");
                });
            } catch (Exception e) { main.post(() -> finishCall((e.getMessage() == null ? "코인이 부족해" : e.getMessage()) + " 통화를 종료해요.")); }
        });
    }
    private void finishCall(String message) {
        if (ended) return;
        ended = true; endMessage = message;
        main.removeCallbacks(billing); main.removeCallbacks(clock); main.removeCallbacks(ringTimeout);
        if (status != null) status.setText("통화를 종료하는 중…");
        for (Button button : new Button[]{mute, camera, flip}) if (button != null) button.setEnabled(false);
        if (end != null) end.setEnabled(false);
        // Daily 통화방에서 정상적으로 나간 뒤(closed) 화면을 닫고, 응답이 없으면 잠시 후 닫는다.
        script("window.forestLeave ? forestLeave() : 0");
        main.postDelayed(this::close, pageLoaded ? 2000 : 0);
    }
    private void close() {
        if (closed) return;
        if (!ended) { finishCall(null); return; }
        closed = true;
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_MESSAGE, endMessage));
        finish();
    }
    @Override public void onBackPressed() { finishCall(null); }
    @Override protected void onDestroy() {
        main.removeCallbacksAndMessages(null); io.shutdownNow();
        if (web != null) { web.removeJavascriptInterface("ForestCall"); web.destroy(); web = null; }
        if (inCall) { AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE); audio.setSpeakerphoneOn(previousSpeaker); audio.setMode(previousAudioMode); inCall = false; }
        super.onDestroy();
    }
}
