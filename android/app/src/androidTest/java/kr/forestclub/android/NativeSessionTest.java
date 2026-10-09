package kr.forestclub.android;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;

/** Uses the repository's local API fixture; never sends credentials to production. */
@RunWith(AndroidJUnit4.class)
public final class NativeSessionTest {
    @Test public void testEncryptedSessionRestoresAndAuthenticatesNativeServices() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext(); String server = "http://10.0.2.2:18743";
        AndroidSessionStore storage = new AndroidSessionStore(context); storage.clear(server);
        ApiClient first = new ApiClient(storage, true); first.setServer(server);
        first.post(new JSONObject().put("email", "test@example.com").put("password", "test-password"), "api", "auth", "login");
        assertEquals(1, first.userId); assertNotNull(storage.read(server));
        String encrypted = context.getSharedPreferences("sessions", Context.MODE_PRIVATE).getAll().values().toString();
        assertFalse(encrypted.contains("native-ui-test")); assertFalse(encrypted.contains("test-password"));
        ApiClient relaunched = new ApiClient(new AndroidSessionStore(context), true); relaunched.setServer(server);
        assertTrue(relaunched.hasSession()); relaunched.get("api", "auth", "me"); assertEquals(1, relaunched.userId);
        assertTrue(relaunched.get("api", "messages", "conversations") instanceof JSONArray);
        JSONObject balance = (JSONObject) relaunched.get("api", "coins", "balance"); assertEquals(5000, balance.getInt("coins"));
        relaunched.post(new JSONObject().put("recipientUserId", 2).put("body", "Android native message"), "api", "messages");
        JSONObject thread = (JSONObject) relaunched.get("api", "messages", "conversations", "2");
        assertEquals("Android native message", thread.getJSONArray("messages").getJSONObject(0).getString("body"));
        assertEquals(4500, ((JSONObject) relaunched.get("api", "coins", "balance")).getInt("coins"));
        relaunched.patch(new JSONObject().put("region", "서울"), "api", "auth", "profile");
        relaunched.get("api", "applications", "me"); relaunched.get("api", "companions", "incoming"); relaunched.get("api", "tickets", "me");
        relaunched.post(new JSONObject(), "api", "auth", "logout"); assertFalse(relaunched.hasSession()); assertNull(storage.read(server));
    }
}
