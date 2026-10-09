package kr.forestclub.android;

public interface SessionStore {
    String read(String server) throws Exception;
    void write(String server, String value) throws Exception;
    void clear(String server) throws Exception;
}
