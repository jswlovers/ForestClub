package kr.forestclub.android;

import java.net.URI;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** 보이스톡 정책. 단가와 진입·유지 최소 잔액은 server/call-pricing.js가 기준이며 서버가 다시 검사한다. */
final class CallPolicy {
    static final int COST_PER_SECOND = 10;
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
