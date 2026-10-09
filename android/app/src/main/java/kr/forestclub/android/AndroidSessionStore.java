package kr.forestclub.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class AndroidSessionStore implements SessionStore {
    private final SharedPreferences preferences;
    private static final String ALIAS = "forest-session-v1";
    AndroidSessionStore(Context context) { preferences = context.getSharedPreferences("sessions", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private String slot(String server) throws Exception {
        return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(server.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }
    @Override public synchronized String read(String server) throws Exception {
        String saved = preferences.getString(slot(server), null); if (saved == null) return null;
        String[] parts = saved.split(":", 2); if (parts.length != 2) throw new IllegalStateException("Invalid saved session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    @Override public synchronized void write(String server, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String saved = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().putString(slot(server), saved).commit()) throw new IllegalStateException("Could not save session");
    }
    @Override public synchronized void clear(String server) throws Exception { if (!preferences.edit().remove(slot(server)).commit()) throw new java.io.IOException("Could not clear session"); }
}
