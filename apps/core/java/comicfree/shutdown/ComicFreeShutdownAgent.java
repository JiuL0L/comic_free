package comicfree.shutdown;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

public final class ComicFreeShutdownAgent {
    private ComicFreeShutdownAgent() {}

    public static void premain(String agentArguments) throws Exception {
        Map<String, String> arguments = parseArguments(agentArguments);
        int port = Integer.parseInt(required(arguments, "port"));
        Path tokenFile = Path.of(new String(
            Base64.getUrlDecoder().decode(required(arguments, "tokenFileBase64")),
            StandardCharsets.UTF_8
        ));
        String token = Files.readString(tokenFile, StandardCharsets.UTF_8);
        Files.deleteIfExists(tokenFile);
        byte[] expectedAuthorization = ("Bearer " + token)
            .getBytes(StandardCharsets.UTF_8);

        HttpServer server = HttpServer.create(
            new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port),
            0
        );
        server.createContext("/comic-free/shutdown", exchange -> {
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            byte[] actualAuthorization = authorization == null
                ? new byte[0]
                : authorization.getBytes(StandardCharsets.UTF_8);
            boolean authorized = MessageDigest.isEqual(
                expectedAuthorization,
                actualAuthorization
            );
            if (!"POST".equals(exchange.getRequestMethod()) || !authorized) {
                exchange.sendResponseHeaders(404, -1);
                exchange.close();
                return;
            }

            exchange.sendResponseHeaders(202, -1);
            exchange.close();
            Thread shutdown = new Thread(() -> {
                try {
                    Thread.sleep(25);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                }
                System.exit(0);
            }, "comic-free-plugin-host-shutdown");
            shutdown.setDaemon(false);
            shutdown.start();
        });
        server.start();
    }

    private static Map<String, String> parseArguments(String raw) {
        Map<String, String> result = new HashMap<>();
        if (raw == null || raw.isBlank()) return result;
        for (String item : raw.split(",")) {
            String[] pair = item.split("=", 2);
            if (pair.length == 2) result.put(pair[0], pair[1]);
        }
        return result;
    }

    private static String required(Map<String, String> arguments, String name) {
        String value = arguments.get(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing shutdown agent argument: " + name);
        }
        return value;
    }
}
