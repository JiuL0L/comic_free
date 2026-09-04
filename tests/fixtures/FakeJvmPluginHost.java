import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class FakeJvmPluginHost {
    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(args[0]);
        Path runtimeRoot = Path.of(args[1]);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                Files.writeString(runtimeRoot.resolve("jvm-shutdown-hook-ran"), "yes", StandardCharsets.UTF_8);
            } catch (Exception error) {
                throw new RuntimeException(error);
            }
        }));

        HttpServer server = HttpServer.create(
            new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port),
            0
        );
        server.createContext("/api/graphql", FakeJvmPluginHost::graphql);
        server.start();
        System.out.println("fake JVM Plugin Host ready");
    }

    private static void graphql(HttpExchange exchange) throws IOException {
        byte[] body = "{\"data\":{\"__typename\":\"Query\"}}".getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }
}
