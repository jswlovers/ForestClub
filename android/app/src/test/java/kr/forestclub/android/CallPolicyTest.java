package kr.forestclub.android;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import org.junit.Test;

public class CallPolicyTest {
    @Test public void acceptsOnlyDailyRooms() {
        assertEquals("https://forest.daily.co/abc", CallPolicy.roomUrl("https://forest.daily.co/abc"));
        assertNull(CallPolicy.roomUrl("http://forest.daily.co/abc"));
        assertNull(CallPolicy.roomUrl("https://daily.co.evil.example/abc"));
        assertNull(CallPolicy.roomUrl("https://user@forest.daily.co/abc"));
        assertNull(CallPolicy.roomUrl("/api/messages/attachments/a.png"));
        assertNull(CallPolicy.roomUrl("javascript:alert(1)"));
    }
    @Test public void incomingCallsExpireAfterWindow() throws Exception {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT); format.setTimeZone(TimeZone.getTimeZone("UTC"));
        long sent = format.parse("2026-10-09 03:00:00").getTime();
        assertTrue(CallPolicy.isRecent("2026-10-09 03:00:00", sent + 30_000));
        assertFalse(CallPolicy.isRecent("2026-10-09 03:00:00", sent + 120_000));
        assertFalse(CallPolicy.isRecent("", sent));
    }
    @Test public void callKindFollowsServerAttachmentName() {
        assertEquals(CallPolicy.Kind.VIDEO, CallPolicy.Kind.of("video"));
        assertEquals(CallPolicy.Kind.VOICE, CallPolicy.Kind.of("voice"));
        assertEquals(CallPolicy.Kind.VOICE, CallPolicy.Kind.of(null));
        assertEquals(100, CallPolicy.Kind.VIDEO.costPerSecond);
        assertEquals(2, CallPolicy.Kind.VIDEO.permissions().length);
    }
    /** iOS와 Android가 같은 통화 페이지를 쓰도록 공유 원본과 Android 자산이 같은지 확인한다. */
    @Test public void callPageMatchesSharedCopy() throws Exception {
        assertArrayEquals(Files.readAllBytes(Paths.get("../../shared/Native/ForestCall.html")), Files.readAllBytes(Paths.get("src/main/assets/ForestCall.html")));
    }
}
