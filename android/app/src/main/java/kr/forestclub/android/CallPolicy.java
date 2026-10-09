package kr.forestclub.android;

import java.net.URI;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** 보이스톡·페이스톡 정책. 단가와 진입·유지 최소 잔액은 server/call-pricing.js가 기준이며 서버가 다시 검사한다. */
final class CallPolicy {
    enum Kind {
        VOICE("voice", "보이스톡", "📞", 10), VIDEO("video", "페이스톡", "📹", 100);
        final String value, title, icon; final int costPerSecond;
        Kind(String value, String title, String icon, int costPerSecond) { this.value = value; this.title = title; this.icon = icon; this.costPerSecond = costPerSecond; }
        /** 서버는 통화 요청 메시지의 attachment_name에 voice/video를 기록한다. */
        static Kind of(String value) { return "video".equals(value) ? VIDEO : VOICE; }
        String[] permissions() { return this == VIDEO ? new String[]{"android.permission.RECORD_AUDIO", "android.permission.CAMERA"} : new String[]{"android.permission.RECORD_AUDIO"}; }
    }
    static final long RING_MILLIS = 60_000, INCOMING_WINDOW_MILLIS = 90_000;
    private CallPolicy() { }
    /** 서버가 만든 Daily.co 통화방 주소만 허용한다. */
    static String roomUrl(String value) {
        try {
            URI uri = new URI(value); String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || host == null || !host.toLowerCase(Locale.ROOT).endsWith(".daily.co")) return null;
            return uri.toASCIIString();
        } catch (Exception e) { return null; }
    }
    /** 서버의 created_at은 SQLite datetime('now') 형식의 UTC 시각이다. */
    static boolean isRecent(String createdAt, long now) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT); format.setTimeZone(TimeZone.getTimeZone("UTC")); format.setLenient(false);
            Date date = format.parse(createdAt); return date != null && Math.abs(now - date.getTime()) <= INCOMING_WINDOW_MILLIS;
        } catch (Exception e) { return false; }
    }
    static String coins(long value) { return String.format(Locale.KOREA, "%,d", value); }
}
