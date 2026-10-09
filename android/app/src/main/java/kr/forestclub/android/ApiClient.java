package kr.forestclub.android;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpCookie;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ApiClient {
    public static final class ApiException extends Exception {
        public final int status;
        ApiException(int status, String message) { super(message); this.status = status; }
    }
    private final SessionStore store;
    private final boolean development;
    private String server = "";
    private String token;
    private boolean secure;
    private long expiresAt;
    private long generation;
    public volatile int userId;
    public volatile String userName;
    public volatile String persistenceError;
    public ApiClient(SessionStore store, boolean development) { this.store = store; this.development = development; }
    public static String validateAddress(String input, boolean development) throws ApiException {
        try {
            URI uri = new URI(input.trim()); String host = uri.getHost();
            boolean local = development && ("localhost".equals(host) || "127.0.0.1".equals(host) || "10.0.2.2".equals(host));
            if (host == null || host.isEmpty() || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || "/".equals(uri.getPath())) || !("https".equals(uri.getScheme()) || (local && "http".equals(uri.getScheme())))) throw new Exception();
            String result = uri.toASCIIString(); return result.endsWith("/") ? result.substring(0, result.length() - 1) : result;
        } catch (Exception e) { throw new ApiException(0, "HTTPS 서버 루트 주소를 입력해주세요."); }
    }
    public synchronized void setServer(String value) throws ApiException {
        server = validateAddress(value, development); generation++; token = null; userId = 0; userName = null; persistenceError = null;
        try {
            String saved = store.read(server);
            if (saved != null) {
                JSONObject session = new JSONObject(saved); expiresAt = session.optLong("expiresAt"); secure = session.optBoolean("secure");
                if (expiresAt > System.currentTimeMillis() || expiresAt == 0) token = session.getString("token");
                else store.clear(server);
            }
        } catch (Exception e) { persistenceError = "저장된 로그인을 복원하지 못했습니다. 다시 로그인해주세요."; }
    }
    public synchronized String server() { return server; }
    public synchronized boolean hasSession() {
        if (token != null && expiresAt != 0 && expiresAt <= System.currentTimeMillis()) clearLogin();
        return token != null;
    }
    public synchronized void clearLogin() {
        token = null; userId = 0; userName = null; generation++;
        try { if (!server.isEmpty()) store.clear(server); } catch (Exception ignored) { }
    }
    private static String encode(String part) throws Exception { return URLEncoder.encode(part, "UTF-8").replace("+", "%20"); }
    public Object get(String... path) throws Exception { return request("GET", null, path); }
    public Object post(JSONObject body, String... path) throws Exception { return request("POST", body, path); }
    public Object patch(JSONObject body, String... path) throws Exception { return request("PATCH", body, path); }
    public Object request(String method, JSONObject body, String... path) throws Exception {
        byte[] bytes = body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8);
        byte[] response = exchange(method, bytes, "application/json", path);
        if (response.length == 0) return new JSONObject();
        return new JSONTokener(new String(response, StandardCharsets.UTF_8)).nextValue();
    }
    private byte[] exchange(String method, byte[] body, String contentType, String... path) throws Exception {
        final String base; final String cookie; final long version;
        synchronized (this) {
            if (server.isEmpty()) throw new ApiException(0, "마이페이지에서 서버를 먼저 연결해주세요.");
            hasSession(); base = server; version = generation;
            cookie = token == null || (secure && !base.startsWith("https://")) ? null : "fc_session=" + token;
        }
        StringBuilder destination = new StringBuilder(base); for (String part : path) destination.append('/').append(encode(part));
        HttpURLConnection connection = (HttpURLConnection) new URL(destination.toString()).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try {
            if (body != null) {
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", contentType); connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(body); }
            }
            int status = connection.getResponseCode();
            byte[] response;
            try (InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { response = readLimited(stream, 20 * 1024 * 1024); }
            synchronized (this) {
                if (version != generation) throw new ApiException(0, "서버 연결 또는 로그인이 변경되었습니다.");
                captureCookies(connection.getHeaderFields());
                boolean authentication = path.length == 3 && "auth".equals(path[1]) && ("login".equals(path[2]) || "signup".equals(path[2]));
                if (status == 401 && !authentication) clearLogin();
                if (status < 200 || status >= 300) {
                    String message = "서버 요청 실패 (" + status + ")";
                    try { message = new JSONObject(new String(response, StandardCharsets.UTF_8)).optString("error", message); } catch (Exception ignored) { }
                    throw new ApiException(status, message);
                }
                if (authentication) {
                    JSONObject user = new JSONObject(new String(response, StandardCharsets.UTF_8)); userId = user.getInt("id"); userName = user.optString("nickname", user.optString("name", "회원")); save();
                }
                if (path.length == 3 && "auth".equals(path[1]) && "me".equals(path[2])) {
                    JSONObject user = new JSONObject(new String(response, StandardCharsets.UTF_8)); userId = user.getInt("id"); userName = user.optString("nickname", user.optString("name", "회원"));
                }
                if (path.length == 3 && "auth".equals(path[1]) && "logout".equals(path[2])) clearLogin();
            }
            return response;
        } finally { connection.disconnect(); }
    }
    private void captureCookies(Map<String, List<String>> headers) {
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !entry.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String header : entry.getValue()) {
                try { for (HttpCookie cookie : HttpCookie.parse(header)) {
                    if (!"fc_session".equals(cookie.getName())) continue;
                    if (cookie.getMaxAge() == 0 || cookie.getValue().isEmpty()) { token = null; continue; }
                    token = cookie.getValue(); secure = cookie.getSecure();
                    expiresAt = cookie.getMaxAge() < 0 ? 0 : System.currentTimeMillis() + cookie.getMaxAge() * 1000;
                } } catch (IllegalArgumentException ignored) { }
            }
        }
    }
    private void save() {
        persistenceError = null;
        try { if (token != null) store.write(server, new JSONObject().put("token", token).put("secure", secure).put("expiresAt", expiresAt).toString()); }
        catch (Exception e) { persistenceError = "로그인은 완료했지만 기기에 세션을 저장하지 못했습니다. 앱을 다시 열면 로그인이 필요할 수 있습니다."; }
    }
    public static byte[] readLimited(InputStream input, int limit) throws Exception {
        if (input == null) return new byte[0];
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(); byte[] bytes = new byte[8192]; int length;
        while ((length = input.read(bytes)) != -1) { if (buffer.size() + length > limit) throw new ApiException(0, "파일 또는 응답 크기가 너무 큽니다."); buffer.write(bytes, 0, length); }
        return buffer.toByteArray();
    }
    public String document(String name) throws Exception { if (!name.equals("terms.html") && !name.equals("privacy.html")) throw new ApiException(0, "잘못된 문서 요청입니다."); return new String(exchange("GET", null, null, name), StandardCharsets.UTF_8); }
    public byte[] attachment(String path) throws Exception {
        if (!path.startsWith("/api/messages/attachments/") || path.contains("..")) throw new ApiException(0, "첨부파일 주소가 올바르지 않습니다.");
        String filename = path.substring("/api/messages/attachments/".length());
        if (filename.contains("/") || filename.contains("\\")) throw new ApiException(0, "첨부파일 주소가 올바르지 않습니다.");
        return exchange("GET", null, null, "api", "messages", "attachments", filename);
    }
    public Object upload(int recipient, String filename, String mime, byte[] data) throws Exception {
        if (data.length > 15 * 1024 * 1024) throw new ApiException(0, "첨부파일은 15MB 이하로 선택해주세요.");
        String boundary = "Forest-" + UUID.randomUUID(); String clean = filename.replace("\"", "_").replace("\r", "_").replace("\n", "_");
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"recipientUserId\"\r\n\r\n" + recipient + "\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + clean + "\"\r\nContent-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(data); body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(exchange("POST", body.toByteArray(), "multipart/form-data; boundary=" + boundary, "api", "messages"), StandardCharsets.UTF_8));
    }
}
