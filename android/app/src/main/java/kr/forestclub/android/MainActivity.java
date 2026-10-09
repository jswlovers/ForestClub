package kr.forestclub.android;

import android.app.Activity;
import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final int GREEN = Color.rgb(33, 75, 56), INK = Color.rgb(28, 37, 31), MUTED = Color.rgb(94, 107, 98);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final ArrayDeque<Screen> history = new ArrayDeque<>();
    private ApiClient api;
    private LinearLayout root, body, toolbar, tabs;
    private ScrollView scroll;
    private TextView title;
    private Button back;
    private Screen current;
    private int generation, activeTab;
    private boolean live, mutation;
    private int attachmentRecipient;
    private Runnable chatPoll, pendingCall;
    private CallPolicy.Kind pendingKind;
    private boolean ringing;
    private final java.util.Set<String> answeredCalls = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    /** 앱이 열려 있는 동안 새 통화 요청을 확인해 받기/거절 창을 띄운다. */
    private final Runnable callPoll = new Runnable() { public void run() { pollIncomingCall(); main.postDelayed(this, 5000); } };
    private String eventType = "all", eventQuery = "";
    private JSONArray eventData = examples();
    interface Drawing { void draw(int version); }
    static final class Screen { final String title; final Drawing drawing; Screen(String title, Drawing drawing) { this.title = title; this.drawing = drawing; } }
    interface Task { Object run() throws Exception; }
    interface Result { void done(Object value); }
    interface Failure { void accept(Exception error); }
    static final class Field {
        String[][] options; final String key, label; final boolean required, multiline; final int type; String value;
        Field(String key, String label, String value, boolean required, int type, boolean multiline) { this.key = key; this.label = label; this.value = value; this.required = required; this.type = type; this.multiline = multiline; }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        api = new ApiClient(new AndroidSessionStore(this), BuildConfig.DEBUG); CallActivity.api = api;
        String server = BuildConfig.DEBUG ? getPreferences(MODE_PRIVATE).getString("testServer", "https://forest.sean2022.one:8888") : "https://forest.sean2022.one:8888";
        if (!server.isEmpty()) { try { api.setServer(server); } catch (Exception ignored) { } }
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(245, 247, 244));
        root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) { Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime()); view.setPadding(i.left, i.top, i.right, i.bottom); }
            else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(8), dp(8), dp(12), dp(8));
        back = button("‹", this::goBack); back.setContentDescription("뒤로"); toolbar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        title = text("포레스트클럽", 19, GREEN); title.setTypeface(null, Typeface.BOLD); toolbar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button menu = button("전체 메뉴", () -> openMenu()); toolbar.addView(menu); root.addView(toolbar);
        scroll = new ScrollView(this); scroll.setFillViewport(true); body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(18), dp(16), dp(18), dp(24)); scroll.addView(body); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        tabs = new LinearLayout(this); tabs.setBackgroundColor(Color.WHITE); String[] labels = {"홈", "모임", "마이페이지", "전체 메뉴"};
        for (int i = 0; i < labels.length; i++) { final int tab = i; Button item = button(labels[i], () -> selectTab(tab)); item.setTextSize(12); tabs.addView(item, new LinearLayout.LayoutParams(0, dp(58), 1)); }
        root.addView(tabs); setContentView(root); root.requestApplyInsets();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        selectTab(0);
    }
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onPause() { super.onPause(); if (chatPoll != null) main.removeCallbacks(chatPoll); main.removeCallbacks(callPoll); }
    @Override protected void onResume() { super.onResume(); if (chatPoll != null) main.postDelayed(chatPoll, 15000); main.postDelayed(callPoll, 3000); }
    @Override protected void onDestroy() { super.onDestroy(); main.removeCallbacksAndMessages(null); io.shutdownNow(); }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color); view.setPadding(0, dp(6), 0, dp(6)); return view; }
    private GradientDrawable box(int color, int radius) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); return d; }
    private Button button(String label, Runnable action) { Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setTextColor(GREEN); b.setOnClickListener(v -> action.run()); return b; }
    private void addButton(String label, Runnable action) { Button b = button(label, action); b.setMinHeight(dp(48)); body.addView(b, new LinearLayout.LayoutParams(-1, -2)); }
    private void section(String label) { TextView v = text(label, 21, INK); v.setTypeface(null, Typeface.BOLD); v.setPadding(0, dp(18), 0, dp(10)); body.addView(v); }
    private void note(String value) { body.addView(text(value, 14, MUTED)); }
    private void card(LinearLayout into, String name, String detail, Runnable action) {
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(16), dp(12), dp(16), dp(12)); card.setBackground(box(Color.WHITE, 14));
        TextView heading = text(name, 17, INK); heading.setTypeface(null, Typeface.BOLD); card.addView(heading); card.addView(text(detail, 14, MUTED));
        if (action != null) { card.setOnClickListener(v -> action.run()); card.setFocusable(true); card.setContentDescription(name + ", " + detail); }
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.bottomMargin = dp(12); into.addView(card, p);
    }
    private void show(Screen screen, boolean push) {
        if (push && current != null) history.push(current);
        if (chatPoll != null) { main.removeCallbacks(chatPoll); chatPoll = null; }
        current = screen; generation++; body.removeAllViews(); title.setText(screen.title); back.setVisibility(history.isEmpty() ? View.GONE : View.VISIBLE); scroll.scrollTo(0, 0); screen.drawing.draw(generation);
    }
    private void goBack() { if (history.isEmpty()) finish(); else show(history.pop(), false); }
    private void selectTab(int tab) {
        history.clear(); activeTab = tab;
        for (int i = 0; i < tabs.getChildCount(); i++) ((Button) tabs.getChildAt(i)).setTextColor(i == tab ? GREEN : MUTED);
        if (tab == 0) show(new Screen("포레스트클럽", this::home), false);
        else if (tab == 1) show(new Screen("함께할 모임", this::events), false);
        else if (tab == 2) show(new Screen("마이페이지", this::account), false);
        else show(new Screen("전체 메뉴", this::menu), false);
    }
    private void async(int version, Task task, Result result) { async(version, task, result, error -> alert(error.getMessage() == null ? "서버 연결을 확인해주세요." : error.getMessage())); }
    private void async(int version, Task task, Result result, Failure failure) {
        io.execute(() -> { try { Object value = task.run(); main.post(() -> { if (!isDestroyed() && generation == version) result.done(value); }); }
            catch (Exception e) { main.post(() -> { if (!isDestroyed() && generation == version) failure.accept(e); }); } });
    }
    private void mutate(int version, Task task, Result result, Failure failure) {
        io.execute(() -> { try { Object value = task.run(); main.post(() -> { mutation = false; if (!isDestroyed() && generation == version) result.done(value); }); }
            catch (Exception e) { main.post(() -> { mutation = false; if (!isDestroyed() && generation == version) failure.accept(e); }); } });
    }
    private void alert(String message) { if (!isFinishing()) new AlertDialog.Builder(this).setTitle("포레스트클럽").setMessage(message).setPositiveButton("확인", null).show(); }
    private void protectedAction(Runnable action) {
        if (api.server().isEmpty()) { alert("서비스 연결을 확인한 후 다시 시도해주세요."); return; }
        if (api.userId > 0) { action.run(); return; }
        if (!api.hasSession()) { login(false, action); return; }
        async(generation, () -> api.get("api", "auth", "me"), value -> { action.run(); }, error -> { if (error instanceof ApiClient.ApiException && ((ApiClient.ApiException) error).status == 401) login(false, action); else alert(error.getMessage()); });
    }
    private void home(int version) {
        TextView hero = text("FOREST CLUB\n\n좋은 사람들과,\n더 넓은 세상으로.\n\n골프와 여행, 함께하는 취향", 27, Color.WHITE); hero.setPadding(dp(24), dp(24), dp(24), dp(24)); hero.setBackground(box(GREEN, 20)); body.addView(hero);
        addButton("모임 둘러보기", () -> selectTab(1)); section("추천 모임");
        LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list); fillEvents(list, eventData, true);
        if (!api.server().isEmpty()) async(version, () -> api.get("api", "events"), value -> { live = true; eventData = (JSONArray) value; fillEvents(list, eventData, true); }, error -> { live = false; note("서버 연결 실패 · 예시 모임입니다."); });
        else note("예시 모임 · 인터넷 연결을 확인해주세요.");
    }
    private void events(int version) {
        LinearLayout filters = new LinearLayout(this); String[] labels = {"전체", "골프", "여행"}; String[] keys = {"all", "golf", "travel"};
        for (int i = 0; i < 3; i++) { final String key = keys[i]; Button b = button(labels[i], () -> { eventType = key; show(current, false); }); b.setTextColor(eventType.equals(key) ? GREEN : MUTED); filters.addView(b, new LinearLayout.LayoutParams(0, -2, 1)); } body.addView(filters);
        EditText search = new EditText(this); search.setHint("모임 검색"); search.setSingleLine(true); search.setText(eventQuery); body.addView(search);
        LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list); fillEvents(list, eventData, false);
        search.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s, int st, int c, int a) {} public void onTextChanged(CharSequence s, int st, int before, int count) { eventQuery = s.toString(); fillEvents(list, eventData, false); } public void afterTextChanged(Editable s) {} });
        addButton("모집 현황 새로고침", () -> show(current, false));
        if (!api.server().isEmpty()) async(version, () -> api.get("api", "events"), value -> { live = true; eventData = (JSONArray) value; fillEvents(list, eventData, false); }, error -> { live = false; note("서버 연결 실패 · 예시 모임입니다."); });
        else note("현재 예시 모임입니다.");
    }
    private void fillEvents(LinearLayout list, JSONArray rows, boolean recommended) {
        list.removeAllViews(); int count = 0;
        for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row == null) continue;
            if (!recommended && ((!eventType.equals("all") && !eventType.equals(row.optString("type"))) || !displayName(row).contains(eventQuery))) continue;
            String capacity = "정원 " + row.optInt("capacity") + "명" + (live ? " · 남은 자리 " + row.optInt("remaining") + "명" : " · 예시 모임");
            card(list, displayName(row), (row.optString("type").equals("golf") ? "골프 · " : "여행 · ") + capacity, () -> event(row)); count++; if (recommended && count == 3) break;
        }
        if (count == 0) list.addView(text("검색 결과가 없습니다.", 16, MUTED));
    }
    private void event(JSONObject row) {
        show(new Screen("모임 안내", version -> {
            section(displayName(row)); note("정원 " + row.optInt("capacity") + "명"); note("참가 문의를 남겨주시면 운영진이 일정과 참가 절차를 안내해드립니다.");
            if (!live) note("예시 모임입니다. 서버 연결 후 문의할 수 있습니다.");
            Button interest = button("참가 문의하기", () -> protectedAction(() -> {
                if (mutation) return; mutation = true;
                mutate(version, () -> api.post(new JSONObject(), "api", "events", displayName(row), "interest"), value -> { mutation = false; alert("참가 문의가 접수되었습니다."); show(current, false); }, error -> { mutation = false; alert(error.getMessage()); });
            })); interest.setEnabled(live && row.optInt("remaining", 1) > 0); body.addView(interest);
            addButton("동행할 회원 찾기", () -> protectedAction(() -> members(row)));
        }), true);
    }
    private void account(int version) {
        section(api.userName == null ? "포레스트클럽과 함께하세요" : api.userName + "님, 반갑습니다");
        note("포레스트클럽 서비스에 자동 연결됩니다.");
        if (api.userId == 0) { addButton("로그인", () -> protectedAction(() -> selectTab(2))); addButton("회원가입", () -> login(true, () -> selectTab(2))); }
        else { for (String item : new String[]{"내 프로필", "쪽지함", "코인 충전", "내 지원 현황", "내 신청함", "고객센터"}) addButton(item, () -> route(item));
            addButton("로그아웃", () -> async(version, () -> api.post(new JSONObject(), "api", "auth", "logout"), value -> { history.clear(); show(current, false); })); }
        note("모든 회원 기능은 앱 안에서 같은 로그인으로 이용합니다. 로그인 세션은 기기에 암호화해 보관됩니다.");
        if (api.userId == 0 && api.hasSession()) async(version, () -> api.get("api", "auth", "me"), value -> show(current, false), error -> { if (!(error instanceof ApiClient.ApiException) || ((ApiClient.ApiException) error).status != 401) note("서버 연결을 확인해주세요."); });
    }
    private void openMenu() { show(new Screen("전체 메뉴", this::menu), true); }
    private void menu(int version) {
        section("모임"); addButton("골프모임", () -> { eventType = "golf"; selectTab(1); }); addButton("여행모임", () -> { eventType = "travel"; selectTab(1); });
        section("회원 서비스"); for (String item : new String[]{"멤버십 · 지원하기", "내 프로필", "내 지원 현황", "내 신청함", "쪽지함", "코인 충전", "고객센터"}) addButton(item, () -> route(item));
        section("포레스트클럽"); addButton("클럽 소개", () -> show(new Screen("클럽 소개", v -> { section("함께하는 취향, 깊어지는 인연"); note("소규모 골프 라운딩과 국내외 여행에서 취향을 나누는 프라이빗 멤버십입니다."); note("온라인 지원 → 서류 심사 → 멤버 인터뷰 → 승인 및 웰컴 라운딩"); }), true)); addButton("로그인 · 계정 관리", () -> selectTab(2));
    }
    private void route(String label) {
        protectedAction(() -> { switch (label) {
            case "내 프로필": profile(); break; case "멤버십 · 지원하기": membershipStatus(); break; case "쪽지함": conversations(); break; case "코인 충전": coins(); break; case "내 신청함": companionInbox(false); break; case "고객센터": support(); break;
            default: membershipStatus();
        } });
    }
    private Field field(String key, String label, boolean required) { return new Field(key, label, "", required, InputType.TYPE_CLASS_TEXT, key.equals("intro") || key.equals("body") || key.equals("message")); }
    interface Submit { Object send(JSONObject values) throws Exception; }
    private void form(String heading, ArrayList<Field> fields, String explanation, String action, Submit submit, Runnable success) {
        show(new Screen(heading, version -> {
            final int boundUser = api.userId; Map<String, EditText> inputs = new LinkedHashMap<>(); Map<String, Spinner> choices = new LinkedHashMap<>();
            for (Field f : fields) { body.addView(text(f.label + (f.required ? " *" : ""), 14, MUTED));
                if (f.options != null) { Spinner picker = new Spinner(this); ArrayList<String> labels = new ArrayList<>(); labels.add("선택해주세요"); for (String[] option : f.options) labels.add(option[0]); picker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels)); picker.setContentDescription(f.label); body.addView(picker); choices.put(f.key, picker); for (int i = 0; i < f.options.length; i++) if (f.options[i][1].equals(f.value)) picker.setSelection(i + 1); picker.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() { public void onNothingSelected(android.widget.AdapterView<?> p) {} public void onItemSelected(android.widget.AdapterView<?> p, View v, int position, long id) { f.value = position == 0 ? "" : f.options[position - 1][1]; } }); continue; }
                EditText e = new EditText(this); e.setHint(f.label); e.setContentDescription(f.label); e.setText(f.value); e.setInputType(f.type | (f.multiline ? InputType.TYPE_TEXT_FLAG_MULTI_LINE : 0)); e.setSingleLine(!f.multiline); if (f.multiline) e.setMinLines(3); body.addView(e); inputs.put(f.key, e);
                e.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s, int st, int c, int a) {} public void onTextChanged(CharSequence s, int st, int before, int count) { if (!f.key.equals("password")) f.value = s.toString(); } public void afterTextChanged(Editable s) {} }); }
            note(explanation);
            Button save = button(action, () -> {
                if (mutation) return;
                if (boundUser > 0 && boundUser != api.userId) { alert("로그인이 변경되었습니다. 메뉴에서 다시 열어주세요."); return; }
                JSONObject values = new JSONObject();
                try { for (Field f : fields) { String input = f.options == null ? inputs.get(f.key).getText().toString() : (choices.get(f.key).getSelectedItemPosition() == 0 ? "" : f.options[choices.get(f.key).getSelectedItemPosition() - 1][1]); if (!f.key.equals("password")) input = input.trim(); if (f.required && input.isEmpty()) { alert(f.label + "을 입력해주세요."); return; } values.put(f.key, input); } }
                catch (Exception error) { alert("입력 내용을 확인해주세요."); return; }
                ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(root.getWindowToken(), 0);
                mutation = true; for (EditText e : inputs.values()) e.setEnabled(false);
                mutate(version, () -> submit.send(values), result -> { mutation = false; success.run(); }, error -> { mutation = false; for (EditText e : inputs.values()) e.setEnabled(true); alert(error.getMessage()); });
            }); body.addView(save);
        }), true);
    }
    private void login(boolean signup, Runnable after) {
        if (api.server().isEmpty()) { alert("서비스 연결을 확인해주세요."); return; }
        if (signup) { signupConsent(after); return; }
        ArrayList<Field> fields = new ArrayList<>();
        fields.add(new Field("email", "이메일", "", true, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, false)); fields.add(new Field("password", "비밀번호", "", true, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, false));
        form(signup ? "회원가입" : "로그인", fields, "한 번 로그인하면 모든 회원 기능을 앱 안에서 이용할 수 있습니다.", signup ? "가입" : "로그인", values -> { if (signup && values.getString("password").length() < 8) throw new ApiClient.ApiException(0, "비밀번호는 8자 이상이어야 합니다."); return api.post(values, "api", "auth", signup ? "signup" : "login"); }, () -> { history.clear(); after.run(); if (api.persistenceError != null) alert(api.persistenceError); });
    }
    interface RowText { String[] render(JSONObject row); }
    interface RowAction { void open(JSONObject row); }
    private void records(String heading, String[] path, RowText render, RowAction action) {
        show(new Screen(heading, version -> {
            TextView state = text("불러오는 중…", 14, MUTED); body.addView(state); LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list);
            addButton("새로고침", () -> show(current, false));
            async(version, () -> api.get(path), value -> { JSONArray rows = (JSONArray) value; state.setText(rows.length() == 0 ? "아직 내역이 없습니다." : ""); for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row == null) continue; String[] display = render.render(row); card(list, display[0], display[1], action == null ? null : () -> action.open(row)); } }, error -> { state.setText(error.getMessage()); if (api.userId == 0) addButton("로그인", () -> protectedAction(() -> show(current, false))); });
        }), true);
    }
    private void conversations() {
        show(new Screen("쪽지함", version -> {
            addButton("새 대화", () -> members(null)); TextView state = text("불러오는 중…", 14, MUTED); body.addView(state);
            async(version, () -> api.get("api", "messages", "conversations"), value -> { JSONArray rows = (JSONArray) value; state.setText(rows.length() == 0 ? "아직 대화가 없습니다." : ""); for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null) card(body, displayName(row) + (row.optInt("unread") > 0 ? " · 새 쪽지 " + row.optInt("unread") : ""), row.optString("lastPreview"), () -> chat(row.optInt("userId"), displayName(row))); } }); addButton("새로고침", () -> show(current, false));
        }), true);
    }
    private void members(JSONObject event) {
        records(event == null ? "새 대화" : "동행할 회원", new String[]{"api", event == null ? "messages" : "companions", "members"}, row -> new String[]{displayName(row), value(row, "region") + " · " + value(row, "interest") + "\n" + value(row, "intro")}, row -> {
            if (event == null) { chat(row.optInt("id"), displayName(row)); return; }
            ArrayList<Field> fields = new ArrayList<>(); fields.add(field("message", "동행 신청 메시지", false));
            form("동행 신청", fields, displayName(row) + "님에게 '" + event.optString("name") + "' 동행을 신청합니다.", "신청", values -> api.post(values.put("targetUserId", row.optInt("id")).put("eventName", event.optString("name")), "api", "companions"), () -> { goBack(); alert("동행 신청을 보냈습니다."); });
        });
    }
    private void chat(int partner, String name) {
        show(new Screen(name, version -> {
            TextView state = text("쪽지 1건당 500코인 · 최대 200자", 14, MUTED); body.addView(state);
            LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list);
            EditText input = new EditText(this); input.setHint("쪽지 내용"); input.setContentDescription("쪽지 내용"); input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE); input.setMinLines(2); body.addView(input);
            Runnable reload = () -> {
                async(version, () -> api.get("api", "messages", "conversations", String.valueOf(partner)), value -> { JSONArray rows = ((JSONObject) value).optJSONArray("messages"); list.removeAllViews(); if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row == null) continue; String path = value(row, "attachment_url"); boolean call = "call".equals(value(row, "attachment_type")); String label = call ? CallPolicy.Kind.of(value(row, "attachment_name")).title + " · 눌러서 참여" : value(row, "attachment_name"); card(list, (row.optInt("sender_id") == api.userId ? "나: " : "상대: ") + row.optString("body"), label + "\n" + value(row, "created_at"), call ? () -> joinCall(row, name) : path.startsWith("/api/messages/attachments/") ? () -> downloadAttachment(path, value(row, "attachment_name"), version) : null); } if (rows != null && rows.length() > 0) noticeCall(rows.optJSONObject(rows.length() - 1), partner, name); }, error -> state.setText(error.getMessage()));
                async(version, () -> api.get("api", "coins", "balance"), value -> state.setText("보유 " + ((JSONObject) value).optInt("available", ((JSONObject) value).optInt("coins")) + "코인 · 발송 500코인 · 최대 200자"), error -> state.setText(error.getMessage()));
            };
            addButton("보내기", () -> {
                String message = input.getText().toString().trim(); if (mutation || message.isEmpty()) return; if (message.length() > 200) { alert("쪽지는 200자 이하로 입력해주세요."); return; }
                mutation = true; input.setEnabled(false);
                mutate(version, () -> api.post(new JSONObject().put("recipientUserId", partner).put("body", message), "api", "messages"), result -> { mutation = false; input.setText(""); input.setEnabled(true); reload.run(); }, error -> { mutation = false; input.setEnabled(true); alert(error.getMessage()); });
            });
            addButton("보이스톡 · 페이스톡 걸기", () -> chooseCall(partner, name, reload));
            addButton("파일 첨부", () -> { attachmentRecipient = partner; Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(picker, 10); });
            reload.run(); chatPoll = new Runnable() { public void run() { if (generation == version && api.userId > 0) { reload.run(); main.postDelayed(this, 15000); } } }; main.postDelayed(chatPoll, 15000);
        }), true);
    }
    private Field choice(String key, String label, String[][] options) { Field field = field(key, label, true); field.options = options; return field; }
    private void signupConsent(Runnable after) {
        boolean[] agreed = new boolean[4];
        show(new Screen("회원가입 · 약관 동의", version -> {
            note("필수 동의 후 회원 정보를 입력합니다.");
            Button next = button("다음", () -> signupIdentity(agreed, after)); next.setEnabled(agreed[0] && agreed[1] && agreed[2]);
            String[] labels = {"[필수] 만 19세 이상입니다", "[필수] 이용약관에 동의합니다", "[필수] 개인정보 수집·이용에 동의합니다", "[선택] 광고성 정보 수신에 동의합니다"};
            for (int i = 0; i < labels.length; i++) { final int index = i; CheckBox check = new CheckBox(this); check.setText(labels[i]); check.setTextColor(INK); check.setChecked(agreed[index]); check.setOnCheckedChangeListener((b, checked) -> { agreed[index] = checked; next.setEnabled(agreed[0] && agreed[1] && agreed[2]); }); body.addView(check); }
            addButton("이용약관 전문", () -> document("terms.html", "이용약관")); addButton("개인정보 처리방침 전문", () -> document("privacy.html", "개인정보 처리방침")); body.addView(next);
        }), true);
    }
    private void document(String name, String heading) {
        async(generation, () -> api.document(name), html -> {
            CharSequence content = Build.VERSION.SDK_INT >= 24 ? android.text.Html.fromHtml((String) html, android.text.Html.FROM_HTML_MODE_COMPACT) : android.text.Html.fromHtml((String) html);
            show(new Screen(heading, version -> { TextView doc = text(content.toString(), 15, INK); body.addView(doc); }), true);
        });
    }
    private void signupIdentity(boolean[] agreed, Runnable after) {
        ArrayList<Field> fields = new ArrayList<>(); fields.add(field("name", "이름", true)); fields.add(field("birthDate", "생년월일 (YYYY-MM-DD)", true));
        fields.add(choice("gender", "성별", new String[][]{{"남성", "male"}, {"여성", "female"}})); fields.add(new Field("phone", "휴대전화 번호", "", true, InputType.TYPE_CLASS_PHONE, false));
        form("회원가입 · 본인 정보", fields, "만 19세 이상만 가입할 수 있습니다.", "다음", values -> {
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT); format.setLenient(false);
            java.util.Date birth; try { birth = format.parse(values.getString("birthDate")); } catch (Exception error) { throw new ApiClient.ApiException(0, "생년월일을 YYYY-MM-DD 형식으로 입력해주세요."); }
            if (birth == null || !format.format(birth).equals(values.getString("birthDate"))) throw new ApiClient.ApiException(0, "생년월일을 확인해주세요.");
            java.util.Calendar minimum = java.util.Calendar.getInstance(); minimum.add(java.util.Calendar.YEAR, -19);
            if (birth.after(minimum.getTime())) throw new ApiClient.ApiException(0, "만 19세 이상만 가입할 수 있습니다.");
            api.post(values, "api", "auth", "signup", "precheck"); for (Field field : fields) field.value = values.optString(field.key); return values;
        }, () -> signupDetails(fields, agreed, after));
    }
    private void signupDetails(ArrayList<Field> identityFields, boolean[] agreed, Runnable after) {
        ArrayList<Field> fields = new ArrayList<>(); fields.add(field("nickname", "닉네임", true)); fields.add(choice("region", "거주 지역", new String[][]{{"서울특별시", "서울특별시"}, {"부산광역시", "부산광역시"}, {"대구광역시", "대구광역시"}, {"인천광역시", "인천광역시"}, {"광주광역시", "광주광역시"}, {"대전광역시", "대전광역시"}, {"울산광역시", "울산광역시"}, {"세종특별자치시", "세종특별자치시"}, {"경기도", "경기도"}, {"강원특별자치도", "강원특별자치도"}, {"충청북도", "충청북도"}, {"충청남도", "충청남도"}, {"전북특별자치도", "전북특별자치도"}, {"전라남도", "전라남도"}, {"경상북도", "경상북도"}, {"경상남도", "경상남도"}, {"제주특별자치도", "제주특별자치도"}})); fields.add(field("job", "직업", true));
        fields.add(choice("maritalStatus", "혼인 여부", new String[][]{{"미혼", "single"}, {"이혼 또는 사별", "divorced_widowed"}, {"법률상 배우자가 있음", "married"}}));
        fields.add(choice("golfExperience", "골프 구력", new String[][]{{"골프는 하지 않음", "골프는 하지 않음"}, {"입문 (1년 미만)", "입문 (1년 미만)"}, {"1~3년", "1~3년"}, {"3~5년", "3~5년"}, {"5~10년", "5~10년"}, {"10년 이상", "10년 이상"}}));
        fields.add(choice("interest", "관심 분야", new String[][]{{"골프", "골프"}, {"여행", "여행"}, {"골프 · 여행 모두", "둘 다"}}));
        fields.add(field("referrer", "추천인", false)); fields.add(field("intro", "자기소개", false)); fields.add(new Field("email", "이메일", "", true, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, false)); fields.add(new Field("password", "비밀번호", "", true, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, false));
        form("회원가입 · 회원 정보", fields, "회원가입이 멤버십 지원으로 접수됩니다. 심사 결과는 내 지원 현황에서 확인하세요.", "가입 신청", values -> {
            if (values.getString("password").length() < 8) throw new ApiClient.ApiException(0, "비밀번호는 8자 이상이어야 합니다.");
            if (values.getString("maritalStatus").equals("married")) throw new ApiClient.ApiException(0, "이용약관에 따라 법률상 배우자가 없는 분만 가입할 수 있습니다.");
            for (Field field : identityFields) values.put(field.key, field.value);
            values.put("ageAgreed", agreed[0]).put("termsAgreed", agreed[1]).put("privacyAgreed", agreed[2]).put("marketingAgreed", agreed[3]);
            return api.post(values, "api", "auth", "signup");
        }, () -> { history.clear(); after.run(); });
    }
    private void membershipStatus() {
        async(generation, () -> api.get("api", "auth", "me"), result -> {
            JSONObject user = (JSONObject) result;
            if (user.has("status")) show(new Screen("내 지원 현황", version -> { section("멤버십 가입 심사"); note(status(user.optString("status"))); note(user.optString("status").equals("pending") ? "가입 심사 승인 후 회원 서비스를 이용할 수 있습니다." : value(user, "rejectedReason")); note(value(user, "interest") + " · " + value(user, "region")); }), true);
            else records("내 지원 현황", new String[]{"api", "applications", "me"}, row -> new String[]{status(row.optString("status")), value(row, "admin_note")}, null);
        });
    }
    private void profile() {
        async(generation, () -> api.get("api", "auth", "me"), response -> { JSONObject row = (JSONObject) response; ArrayList<Field> fields = profileFields(row, false);
            form("내 프로필", fields, "연락처는 010-1234-5678 형식으로 입력해주세요.", "저장", values -> api.patch(values, "api", "auth", "profile"), () -> { goBack(); alert("프로필을 저장했습니다."); }); });
    }
    private ArrayList<Field> profileFields(JSONObject row, boolean application) {
        ArrayList<Field> fields = new ArrayList<>(); String[][] definitions = application ? new String[][]{{"name", "이름"}, {"phone", "연락처"}, {"email", "이메일"}, {"ageGroup", "연령대"}, {"region", "지역"}, {"job", "직업"}, {"golfExperience", "골프 구력"}, {"interest", "관심 분야"}, {"referrer", "추천인"}, {"intro", "자기소개"}} : new String[][]{{"phone", "연락처"}, {"ageGroup", "연령대"}, {"region", "지역"}, {"job", "직업"}, {"golfExperience", "골프 구력"}, {"interest", "관심 분야"}, {"intro", "자기소개"}};
        for (String[] item : definitions) fields.add(new Field(item[0], item[1], value(row, item[0]), application && (item[0].equals("name") || item[0].equals("phone") || item[0].equals("email")), item[0].equals("phone") ? InputType.TYPE_CLASS_PHONE : InputType.TYPE_CLASS_TEXT, item[0].equals("intro"))); return fields;
    }
    private void application() { async(generation, () -> api.get("api", "auth", "me"), response -> form("멤버십 지원서", profileFields((JSONObject) response, true), "온라인 지원 → 서류 심사 → 멤버 인터뷰 → 승인 및 웰컴", "지원", values -> api.post(values, "api", "applications"), () -> { goBack(); alert("멤버십 지원서가 접수되었습니다."); })); }
    private void coins() {
        show(new Screen("코인", version -> {
            section("보유 코인"); TextView balance = text("불러오는 중…", 25, GREEN); body.addView(balance); note("쪽지 1건당 500코인 · 1코인 = 1원");
            addButton("충전 신청", () -> { ArrayList<Field> fields = new ArrayList<>(); fields.add(new Field("amountKrw", "충전 금액 (원)", "", true, InputType.TYPE_CLASS_NUMBER, false));
                form("코인 충전 신청", fields, "최소 1,000원 · 무통장입금 신청입니다. 운영진이 입금을 확인하고 승인하면 코인이 지급됩니다.", "신청", values -> { long amount; try { amount = Long.parseLong(values.getString("amountKrw")); } catch (Exception e) { throw new ApiClient.ApiException(0, "금액을 확인해주세요."); } if (amount < 1000 || amount > 1000000000) throw new ApiClient.ApiException(0, "1,000원 이상 10억원 이하로 입력해주세요."); return api.post(new JSONObject().put("amountKrw", amount).put("provider", "manual"), "api", "coins", "charge-requests"); }, () -> { goBack(); alert("충전 신청을 접수했습니다. 운영진의 확인과 승인을 기다려주세요."); }); });
            addButton("충전 내역", () -> records("충전 신청 내역", new String[]{"api", "coins", "charge-requests", "me"}, row -> new String[]{row.optLong("amount_krw") + "원 · " + status(row.optString("status")), value(row, "admin_note") + "\n" + value(row, "created_at")}, null));
            addButton("코인 사용 내역", () -> records("코인 사용 내역", new String[]{"api", "coins", "ledger"}, row -> new String[]{(row.optString("direction").equals("credit") ? "+" : "−") + row.optLong("amount") + " 코인", value(row, "note") + "\n" + value(row, "created_at")}, null));
            async(version, () -> api.get("api", "coins", "balance"), value -> balance.setText(((JSONObject) value).optLong("available", ((JSONObject) value).optLong("coins")) + " 코인"), error -> balance.setText(error.getMessage()));
        }), true);
    }
    private void companionInbox(boolean outgoing) {
        show(new Screen("내 신청함", version -> {
            addButton(outgoing ? "받은 신청 보기" : "보낸 신청 보기", () -> showCompanions(!outgoing)); TextView state = text("불러오는 중…", 14, MUTED); body.addView(state);
            async(version, () -> api.get("api", "companions", outgoing ? "outgoing" : "incoming"), value -> { JSONArray rows = (JSONArray) value; state.setText(rows.length() == 0 ? "신청 내역이 없습니다." : ""); for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row == null) continue; card(body, row.optString("event_name"), (outgoing ? row.optString("target_nickname", row.optString("target_name")) : row.optString("requester_nickname", row.optString("requester_name"))) + " · " + status(row.optString("status")) + "\n" + value(row, "message"), row.optString("status").equals("pending") ? () -> {
                String[] labels = outgoing ? new String[]{"신청 취소"} : new String[]{"수락", "거절"}; String[] actions = outgoing ? new String[]{"cancel"} : new String[]{"accept", "decline"}; new AlertDialog.Builder(this).setTitle(row.optString("event_name")).setItems(labels, (dialog, choice) -> async(version, () -> api.post(new JSONObject(), "api", "companions", String.valueOf(row.optInt("id")), actions[choice]), result -> show(current, false))).setNegativeButton("닫기", null).show();
            } : null); } });
        }), true);
    }
    private void showCompanions(boolean outgoing) { if (!history.isEmpty()) history.pop(); companionInbox(outgoing); }
    private void support() {
        show(new Screen("고객센터", version -> {
            addButton("문의하기", () -> new AlertDialog.Builder(this).setTitle("문의 유형").setItems(new String[]{"일반 문의", "불편 사항", "환불 문의", "회원 신고"}, (dialog, choice) -> {
                String category = new String[]{"other", "complaint", "refund", "report"}[choice]; if (category.equals("report")) records("신고할 회원", new String[]{"api", "tickets", "target-members"}, row -> new String[]{displayName(row), ""}, row -> supportForm(category, row.optInt("id"))); else supportForm(category, 0);
            }).setNegativeButton("취소", null).show());
            async(version, () -> api.get("api", "tickets", "me"), value -> { JSONArray rows = (JSONArray) value; if (rows.length() == 0) note("접수된 문의가 없습니다."); for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null) card(body, row.optString("subject") + " · " + status(row.optString("status")), value(row, "body") + "\n" + value(row, "admin_note"), null); } });
        }), true);
    }
    private void supportForm(String category, int target) { ArrayList<Field> fields = new ArrayList<>(); fields.add(field("subject", "제목", true)); fields.add(field("body", "내용", true)); form("문의 작성", fields, "앱에서 접수하고 답변을 확인할 수 있습니다.", "접수", values -> { values.put("category", category); if (target > 0) values.put("targetUserId", target); return api.post(values, "api", "tickets"); }, () -> { history.clear(); support(); alert("문의가 접수되었습니다."); }); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 20) { String message = data == null ? null : data.getStringExtra(CallActivity.EXTRA_MESSAGE); if (message != null && !message.isEmpty()) alert(message); if (current != null) show(current, false); return; }
        if (request != 10 || result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData(); final int partner = attachmentRecipient, version = generation;
        new AlertDialog.Builder(this).setTitle("파일 전송").setMessage("첨부파일 발송에 500코인이 사용됩니다. 최대 15MB까지 전송할 수 있습니다.").setNegativeButton("취소", null).setPositiveButton("보내기", (dialog, which) -> {
            if (mutation) return; mutation = true;
            mutate(version, () -> { String name = "첨부파일"; try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0); }
                String mime = mimeFor(name); if (mime == null) throw new ApiClient.ApiException(0, "지원하지 않는 파일 형식입니다."); byte[] bytes; try (InputStream stream = getContentResolver().openInputStream(uri)) { bytes = ApiClient.readLimited(stream, 15 * 1024 * 1024); } return api.upload(partner, name, mime, bytes);
            }, value -> { mutation = false; show(current, false); }, error -> { mutation = false; alert(error.getMessage()); });
        }).show();
    }
    private void pollIncomingCall() {
        if (api.userId == 0 || ringing || CallActivity.inCall || isFinishing()) return;
        io.execute(() -> { try { JSONArray rows = (JSONArray) api.get("api", "messages", "conversations");
            for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i);
                if (row == null || !"[통화 요청]".equals(row.optString("lastPreview")) || row.optBoolean("lastMine") || row.optInt("unread") == 0) continue;
                int partner = row.optInt("userId"); String at = value(row, "lastAt");
                if (!CallPolicy.isRecent(at, System.currentTimeMillis()) || answeredCalls.contains(partner + "|" + at)) continue;
                // 보이스톡인지 페이스톡인지는 통화 요청 메시지에만 있으므로 대화를 읽어 확인한다.
                JSONArray messages = ((JSONObject) api.get("api", "messages", "conversations", String.valueOf(partner))).optJSONArray("messages");
                JSONObject call = messages == null || messages.length() == 0 ? null : messages.optJSONObject(messages.length() - 1);
                String name = displayName(row); main.post(() -> noticeCall(call, partner, name)); return; }
        } catch (Exception ignored) { } });
    }
    /** 대화창이 이미 읽음 처리한 통화 요청도 놓치지 않도록 새 메시지마다 확인한다. */
    private void noticeCall(JSONObject row, int partner, String name) {
        if (row != null && "call".equals(value(row, "attachment_type")) && row.optInt("sender_id") == partner) offerCall(row, partner, name);
    }
    private void offerCall(JSONObject call, int partner, String name) {
        String at = value(call, "created_at"); CallPolicy.Kind kind = CallPolicy.Kind.of(value(call, "attachment_name"));
        if (ringing || CallActivity.inCall || isFinishing() || !CallPolicy.isRecent(at, System.currentTimeMillis()) || !answeredCalls.add(partner + "|" + at)) return;
        ringing = true;
        new AlertDialog.Builder(this).setTitle(kind.icon + " " + kind.title).setMessage(name + "님이 " + kind.title + "을 걸었어요.").setCancelable(false)
            .setNegativeButton("거절", (d, w) -> ringing = false)
            .setPositiveButton("받기", (d, w) -> { ringing = false; joinCall(call, name); }).show();
    }
    /** 받은 통화 메시지로 들어간다. */
    private void joinCall(JSONObject row, String name) {
        String room = CallPolicy.roomUrl(value(row, "attachment_url")); if (room == null) { alert("통화방 주소가 올바르지 않습니다."); return; }
        CallPolicy.Kind kind = CallPolicy.Kind.of(value(row, "attachment_name"));
        prepareCall(kind, () -> openCall(room, kind, name));
    }
    private void chooseCall(int partner, String name, Runnable reload) {
        CallPolicy.Kind[] kinds = CallPolicy.Kind.values(); String[] labels = new String[kinds.length];
        for (int i = 0; i < kinds.length; i++) labels[i] = kinds[i].icon + " " + kinds[i].title + " (초당 " + CallPolicy.coins(kinds[i].costPerSecond) + "코인)";
        new AlertDialog.Builder(this).setTitle("통화").setItems(labels, (d, which) -> placeCall(kinds[which], partner, name, reload)).setNegativeButton("취소", null).show();
    }
    /** 상대에게 보이스톡이나 페이스톡을 건다. 통화방은 서버가 만들고 대화에 통화 요청 메시지로 남긴다. */
    private void placeCall(CallPolicy.Kind kind, int partner, String name, Runnable reload) {
        prepareCall(kind, () -> new AlertDialog.Builder(this).setTitle(kind.title).setMessage(name + "님에게 " + kind.title + "을 걸까요?\n통화방에 들어간 순간부터 초당 " + CallPolicy.coins(kind.costPerSecond) + "코인이 사용됩니다.").setNegativeButton("취소", null)
            .setPositiveButton("걸기", (d, w) -> io.execute(() -> {
                try { JSONObject result = (JSONObject) api.post(new JSONObject().put("recipientUserId", partner).put("kind", "call").put("callType", kind.value), "api", "messages");
                    String room = CallPolicy.roomUrl(value(result, "attachmentUrl"));
                    main.post(() -> { reload.run(); if (room == null) alert("통화방을 만들지 못했어요. 잠시 후 다시 시도해주세요."); else openCall(room, kind, name); });
                } catch (Exception e) { main.post(() -> alert(e.getMessage())); }
            })).show());
    }
    /** 코인 진입 잔액과 마이크(페이스톡은 카메라도) 권한을 차례로 확인한다. */
    private void prepareCall(CallPolicy.Kind kind, Runnable action) {
        if (CallActivity.inCall) return;
        io.execute(() -> {
            try { JSONObject info = (JSONObject) api.get("api", "calls", "can-enter");
                main.post(() -> {
                    if (!info.optBoolean("allowed")) { alert("코인이 " + CallPolicy.coins(info.optLong("entryMin", 3000)) + "개 이하면 통화를 시작할 수 없어요. 충전 후 다시 시도해주세요."); return; }
                    ArrayList<String> missing = new ArrayList<>();
                    for (String permission : kind.permissions()) if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
                    if (missing.isEmpty()) { action.run(); return; }
                    pendingCall = action; pendingKind = kind; requestPermissions(missing.toArray(new String[0]), 21);
                });
            } catch (Exception e) { main.post(() -> alert(e.getMessage())); }
        });
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != 21) return;
        Runnable action = pendingCall; CallPolicy.Kind kind = pendingKind; pendingCall = null; pendingKind = null;
        boolean granted = results.length > 0; for (int result : results) granted &= result == PackageManager.PERMISSION_GRANTED;
        if (granted && action != null) action.run();
        else if (kind != null) alert((kind == CallPolicy.Kind.VIDEO ? "마이크와 카메라" : "마이크") + "를 허용해야 " + kind.title + "을 이용할 수 있어요. 설정 > 앱 > 포레스트클럽 > 권한에서 허용해주세요.");
    }
    private void openCall(String room, CallPolicy.Kind kind, String name) {
        if (CallActivity.inCall) return;
        startActivityForResult(new Intent(this, CallActivity.class).putExtra(CallActivity.EXTRA_ROOM, room).putExtra(CallActivity.EXTRA_KIND, kind.value).putExtra(CallActivity.EXTRA_NAME, name), 20);
    }
    private void downloadAttachment(String path, String filename, int version) {
        async(version, () -> { byte[] bytes = api.attachment(path); File folder = new File(getCacheDir(), "attachments"); if (!folder.exists() && !folder.mkdirs()) throw new Exception("파일을 저장하지 못했습니다."); String clean = new File(filename).getName(); File file = new File(folder, java.util.UUID.randomUUID() + "-" + (clean.isEmpty() ? "attachment" : clean)); try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); } return file; }, value -> {
            File file = (File) value; String mime = mimeFor(file.getName());
            if (mime != null && (mime.startsWith("image/") || mime.equals("application/pdf"))) startActivity(new Intent(this, AttachmentActivity.class).putExtra("file", file.getAbsolutePath()).putExtra("mime", mime));
            else { Uri uri = Uri.parse("content://" + getPackageName() + ".attachments/" + file.getName()); Intent open = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime == null ? "application/octet-stream" : mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); try { startActivity(open); } catch (android.content.ActivityNotFoundException error) { alert("이 파일 형식을 열 수 있는 앱이 필요합니다."); } }
        });
    }
    static String mimeFor(String name) { int dot = name.lastIndexOf('.'); String extension = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(java.util.Locale.ROOT); switch (extension) { case "jpg": case "jpeg": return "image/jpeg"; case "png": return "image/png"; case "gif": return "image/gif"; case "webp": return "image/webp"; case "pdf": return "application/pdf"; case "doc": return "application/msword"; case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; case "xls": return "application/vnd.ms-excel"; case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; case "ppt": return "application/vnd.ms-powerpoint"; case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation"; case "txt": return "text/plain"; case "zip": return "application/zip"; default: return null; } }
    static String displayName(JSONObject row) { return row.optString("nickname", row.optString("name", "회원")); }
    static String value(JSONObject row, String key) { return row.isNull(key) ? "" : row.optString(key, ""); }
    static String status(String status) { switch (status) { case "pending": return "대기 중"; case "approved": return "승인"; case "rejected": return "반려"; case "accepted": return "수락"; case "declined": return "거절"; case "cancelled": return "취소"; case "open": return "접수"; case "resolved": return "처리 완료"; case "closed": return "종료"; default: return status; } }
    private static JSONArray examples() { JSONArray result = new JSONArray(); String[] names = {"제주 프리미엄 투어 라운딩", "남부권 정기 라운딩", "웰컴 라운딩", "스코틀랜드 골프 오리진 투어", "발리 웰니스 & 골프 리트릿", "나파밸리 와인 & 골프 투어"}; int[] capacity = {8, 12, 6, 10, 12, 10}; try { for (int i = 0; i < names.length; i++) result.put(new JSONObject().put("id", "example-" + i).put("name", names[i]).put("type", i < 3 ? "golf" : "travel").put("capacity", capacity[i])); } catch (Exception ignored) { } return result; }
}
