package kr.forestclub.android;

import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.Dispatcher;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class ApiClientTest {
    private MockWebServer server;
    private String address;
    private MemoryStore store;
    private final AtomicInteger logins = new AtomicInteger();
    private volatile boolean expired;
    private volatile int chargedAmount;
    static class MemoryStore implements SessionStore {
        final Map<String, String> values = new HashMap<>();
        public String read(String server) { return values.get(server); }
        public void write(String server, String value) { values.put(server, value); }
        public void clear(String server) { values.remove(server); }
    }
    @Before public void start() throws Exception {
        store = new MemoryStore(); expired = false;
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath(), cookie = request.getHeader("Cookie");
                MockResponse response = new MockResponse().setHeader("Content-Type", "application/json");
                if (path.equals("/api/auth/login")) {
                    logins.incrementAndGet();
                    return response.setHeader("Set-Cookie", "fc_session=shared-android-test; Path=/; HttpOnly; Max-Age=3600").setBody("{\"id\":1,\"name\":\"회원\"}");
                }
                if (expired || cookie == null || !cookie.contains("fc_session=shared-android-test")) return response.setResponseCode(401).setBody("{\"error\":\"로그인이 필요합니다\"}");
                if (path.equals("/api/auth/logout")) return response.setHeader("Set-Cookie", "fc_session=; Path=/; Max-Age=0").setBody("{}");
                if (path.equals("/api/auth/me")) return response.setBody("{\"id\":1,\"name\":\"회원\"}");
                if (path.equals("/api/coins/charge-requests")) {
                    try { chargedAmount = new JSONObject(request.getBody().readUtf8()).getInt("amountKrw"); return response.setBody("{\"id\":2,\"status\":\"pending\"}"); }
                    catch (Exception error) { return response.setResponseCode(400); }
                }
                if (path.equals("/api/coins/balance")) return response.setBody("{\"coins\":5000}");
                return response.setBody("[]");
            }
        });
        server.start(); address = server.url("/").toString(); address = address.substring(0, address.length() - 1);
    }
    @After public void stop() throws Exception { server.shutdown(); }
    private ApiClient login() throws Exception {
        ApiClient api = new ApiClient(store, true); api.setServer(address);
        api.post(new JSONObject().put("email", "test@example.com").put("password", "test-password"), "api", "auth", "login"); return api;
    }
    @Test public void oneLoginAuthenticatesAllMemberApis() throws Exception {
        ApiClient api = login(); assertEquals(1, api.userId);
        api.get("api", "messages", "conversations"); api.get("api", "coins", "balance"); api.get("api", "auth", "me");
        api.get("api", "applications", "me"); api.get("api", "companions", "incoming"); api.get("api", "tickets", "me");
        assertEquals(1, logins.get());
    }
    @Test public void sessionRestoresWithoutSavingPassword() throws Exception {
        login(); String saved = store.read(address); assertNotNull(saved); assertFalse(saved.contains("test-password")); assertFalse(saved.contains("test@example.com"));
        ApiClient relaunched = new ApiClient(store, true); relaunched.setServer(address); assertTrue(relaunched.hasSession());
        relaunched.get("api", "auth", "me"); assertEquals(1, relaunched.userId); relaunched.get("api", "coins", "balance"); assertEquals(1, logins.get());
    }
    @Test public void logoutAndExpiryClearSavedSession() throws Exception {
        ApiClient api = login(); api.post(new JSONObject(), "api", "auth", "logout"); assertEquals(0, api.userId); assertFalse(api.hasSession()); assertNull(store.read(address));
        api = login(); expired = true;
        try { api.get("api", "coins", "balance"); fail("Expected expired session"); } catch (ApiClient.ApiException e) { assertEquals(401, e.status); }
        assertEquals(0, api.userId); assertFalse(api.hasSession()); assertNull(store.read(address));
    }
    @Test public void serverSwitchDoesNotLeakCookies() throws Exception {
        ApiClient api = login(); api.setServer("http://127.0.0.1:1"); assertFalse(api.hasSession()); assertEquals(0, api.userId);
        api.setServer(address); assertTrue(api.hasSession());
    }
    @Test public void productionRequiresHttpsAndRootUrl() throws Exception {
        assertEquals("https://forest.example", ApiClient.validateAddress(" https://forest.example/ ", false));
        for (String input : new String[]{"http://forest.example", "http://127.0.0.1", "https://user:password@forest.example", "https://forest.example/api", "https://forest.example?token=x"}) {
            try { ApiClient.validateAddress(input, false); fail(input); } catch (ApiClient.ApiException expected) { }
        }
        assertEquals("http://10.0.2.2:3000", ApiClient.validateAddress("http://10.0.2.2:3000", true));
    }
    @Test public void chargePayloadPreservesNumericAmount() throws Exception {
        ApiClient api = login(); JSONObject response = (JSONObject) api.post(new JSONObject().put("amountKrw", 1000).put("provider", "manual"), "api", "coins", "charge-requests");
        assertEquals(1000, chargedAmount); assertEquals("pending", response.getString("status"));
    }
}
