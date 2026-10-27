package com.nexacrm.controller;

import com.nexacrm.service.CommunicationService;
import com.nexacrm.service.LeadService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;

@RestController
@RequestMapping("/api/webhooks")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Webhooks", description = "Inbound channel webhooks")
public class WebhookController {

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final CommunicationService communicationService;
    private final LeadService leadService;
    private final ObjectMapper objectMapper;

    @Value("${meta.app-secret}")
    private String metaAppSecret;

    @Value("${meta.webhook-token}")
    private String metaWebhookToken;

    @Value("${nexacrm.whatsapp.webhook-token:${meta.webhook-token:}}")
    private String whatsappWebhookToken;

    @GetMapping({"", "/"})
    @Operation(summary = "Webhook root health/check endpoint")
    public ResponseEntity<Map<String, Object>> webhookRoot() {
        return ResponseEntity.ok(Map.of(
            "ok", true,
            "facebookLeadsPath", "/api/webhooks/facebook/leads",
            "facebookMessagesPath", "/api/webhooks/facebook/messages",
            "facebookMessengerAliasPath", "/api/webhooks/facebook/messenger",
            "instagramMessagesPath", "/api/webhooks/instagram/messages",
            "facebookLegacyPath", "/api/webhooks/meta",
            "whatsappPath", "/api/webhooks/whatsapp"
        ));
    }

    @PostMapping("/whatsapp")
    @Operation(summary = "Receive inbound WhatsApp webhook events")
    public ResponseEntity<Map<String, Object>> receiveWhatsAppWebhook(
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestHeader(value = "X-Webhook-Token", required = false) String webhookToken,
            @RequestHeader(value = "X-WhatsApp-Webhook-Token", required = false) String whatsappToken,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody String rawBody) {
        if (!isValidWhatsAppJsonWebhook(rawBody, signature, webhookToken, whatsappToken, bearerToken(authorization))) {
            log.warn("WhatsApp webhook rejected: invalid signature/token");
            return ResponseEntity.status(403).body(Map.of("ok", false, "error", "Forbidden"));
        }

        Map<String, Object> payload;
        try {
            payload = objectMapper.readValue(rawBody, MAP_TYPE);
        } catch (Exception e) {
            log.warn("WhatsApp webhook rejected: invalid JSON payload");
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "Invalid JSON payload"));
        }
        return ResponseEntity.ok(communicationService.processWhatsAppWebhook(payload));
    }

    @PostMapping(value = "/whatsapp", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    @Operation(summary = "Receive inbound WhatsApp webhook events (form payload)")
    public ResponseEntity<Map<String, Object>> receiveWhatsAppWebhookForm(
            @RequestHeader(value = "X-Webhook-Token", required = false) String webhookToken,
            @RequestHeader(value = "X-WhatsApp-Webhook-Token", required = false) String whatsappToken,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam MultiValueMap<String, String> form) {
        if (!isValidWebhookToken(webhookToken, whatsappToken, bearerToken(authorization))) {
            log.warn("WhatsApp form webhook rejected: invalid token");
            return ResponseEntity.status(403).body(Map.of("ok", false, "error", "Forbidden"));
        }

        Map<String, Object> payload = new HashMap<>();
        form.forEach((key, value) -> {
            if (value != null && !value.isEmpty()) {
                payload.put(key, value.size() == 1 ? value.get(0) : value);
            }
        });
        Map<String, Object> normalizedPayload = inflateJsonFields(payload);
        return ResponseEntity.ok(communicationService.processWhatsAppWebhook(normalizedPayload));
    }

    @GetMapping("/whatsapp")
    @Operation(summary = "Health/check endpoint for WhatsApp webhook URL")
    public ResponseEntity<Map<String, Object>> verifyWhatsAppWebhook(@RequestParam Map<String, String> query) {
        Map<String, Object> response = new HashMap<>();
        response.put("ok", true);
        response.put("receivedQuery", query);
        return ResponseEntity.ok(response);
    }

    // ── Facebook Lead Ads ─────────────────────────────────────────

    @GetMapping({"/facebook/leads", "/facebook/messages", "/facebook/messenger", "/instagram/messages", "/meta"})
    @Operation(summary = "Facebook/Meta webhook verification (Lead Ads + Messenger)")
    public ResponseEntity<String> verifyFacebookWebhook(@RequestParam Map<String, String> query) {
        String mode = firstNonBlank(query, "hub.mode", "hub_mode", "mode");
        String verifyToken = firstNonBlank(query, "hub.verify_token", "hub_verify_token", "verify_token");
        String challenge = firstNonBlank(query, "hub.challenge", "hub_challenge", "challenge");

        if (!"subscribe".equals(mode) || challenge == null) {
            log.warn("Facebook webhook verification missing required query params: {}", query.keySet());
            return ResponseEntity.badRequest().body("Missing required webhook verification query params");
        }

        if (Objects.equals(trim(metaWebhookToken), trim(verifyToken))) {
            log.info("Facebook/Meta webhook verified");
            return ResponseEntity.ok(challenge);
        }
        log.warn(
            "Facebook webhook verification failed: mode={}, token_match={}",
            mode,
            Objects.equals(trim(metaWebhookToken), trim(verifyToken))
        );
        return ResponseEntity.status(403).build();
    }

    @PostMapping("/facebook/leads")
    @Operation(summary = "Receive Facebook Lead Ads webhook events")
    public ResponseEntity<Void> receiveFacebookLeadsWebhook(
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestBody String rawBody) {
        if (!isValidFacebookSignature(rawBody, signature)) {
            log.warn("Facebook Lead Ads webhook rejected: invalid signature");
            return ResponseEntity.status(403).build();
        }
        leadService.processFacebookLeadsWebhookAsync(rawBody);
        return ResponseEntity.ok().build();
    }

    @PostMapping({"/facebook/messages", "/facebook/messenger"})
    @Operation(summary = "Receive Facebook Messenger webhook events")
    public ResponseEntity<Void> receiveFacebookMessagesWebhook(
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestBody String rawBody) {
        if (!isValidFacebookSignature(rawBody, signature)) {
            log.warn("Facebook Messenger webhook rejected: invalid signature");
            return ResponseEntity.status(403).build();
        }
        communicationService.processFacebookMessengerWebhookAsync(rawBody);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/instagram/messages")
    @Operation(summary = "Receive Instagram Messaging webhook events")
    public ResponseEntity<Void> receiveInstagramMessagesWebhook(
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestBody String rawBody) {
        if (!isValidFacebookSignature(rawBody, signature)) {
            log.warn("Instagram webhook rejected: invalid signature");
            return ResponseEntity.status(403).build();
        }
        communicationService.processInstagramMessengerWebhookAsync(rawBody);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/meta")
    @Operation(summary = "Receive legacy Facebook/Meta webhook events (auto-routes by payload)")
    public ResponseEntity<Void> receiveFacebookLegacyWebhook(
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
            @RequestBody String rawBody) {
        if (!isValidFacebookSignature(rawBody, signature)) {
            log.warn("Facebook legacy webhook rejected: invalid signature");
            return ResponseEntity.status(403).build();
        }
        routeLegacyMetaWebhook(rawBody);
        return ResponseEntity.ok().build();
    }

    private boolean isValidFacebookSignature(String body, String signatureHeader) {
        if (!isConfiguredSecret(metaAppSecret)) {
            log.warn("Facebook/Meta webhook signature rejected: meta.app-secret is not configured");
            return false;
        }
        if (signatureHeader == null || !signatureHeader.startsWith("sha256=")) {
            return false;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(metaAppSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal(body.getBytes(StandardCharsets.UTF_8));
            String expectedHex = HexFormat.of().formatHex(expected);
            String actual = signatureHeader.substring("sha256=".length());
            return MessageDigest.isEqual(expectedHex.getBytes(StandardCharsets.UTF_8),
                                         actual.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            log.error("Signature verification error", e);
            return false;
        }
    }

    private void routeLegacyMetaWebhook(String rawBody) {
        boolean routedAny = false;
        try {
            var root = objectMapper.readTree(rawBody);
            String object = trim(root.path("object").asText(""));
            if ("instagram".equalsIgnoreCase(object)) {
                communicationService.processInstagramMessengerWebhookAsync(rawBody);
                return;
            }
            var entries = root.path("entry");
            if (entries.isArray()) {
                for (var entry : entries) {
                    var changes = entry.path("changes");
                    if (changes.isArray()) {
                        for (var change : changes) {
                            if ("leadgen".equals(change.path("field").asText())) {
                                leadService.processFacebookLeadsWebhookAsync(rawBody);
                                routedAny = true;
                                break;
                            }
                        }
                    }

                    if (entry.path("messaging").isArray()) {
                        communicationService.processFacebookMessengerWebhookAsync(rawBody);
                        routedAny = true;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not parse legacy Meta webhook payload for route split", e);
        }

        if (!routedAny) {
            // Legacy compatibility fallback: previous behavior attempted both handlers.
            leadService.processFacebookLeadsWebhookAsync(rawBody);
            communicationService.processFacebookMessengerWebhookAsync(rawBody);
        }
    }

    // ── WhatsApp helpers ──────────────────────────────────────────

    private boolean isValidWhatsAppJsonWebhook(String body, String signatureHeader, String... tokenCandidates) {
        if (!isConfiguredSecret(whatsappWebhookToken)) {
            // If no secret configured, accept webhook from local/OpenWA
            return true;
        }
        return isValidFacebookSignature(body, signatureHeader) || isValidWebhookToken(tokenCandidates);
    }

    private boolean isValidWebhookToken(String... tokenCandidates) {
        if (!isConfiguredSecret(whatsappWebhookToken)) {
            log.warn("WhatsApp webhook token is not configured");
            return false;
        }
        String expected = trim(whatsappWebhookToken);
        for (String candidate : tokenCandidates) {
            String actual = trim(candidate);
            if (actual == null || actual.isBlank()) {
                continue;
            }
            if (MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8),
                    actual.getBytes(StandardCharsets.UTF_8))) {
                return true;
            }
        }
        return false;
    }

    private String bearerToken(String authorization) {
        String header = trim(authorization);
        if (header == null || !header.toLowerCase().startsWith("bearer ")) {
            return null;
        }
        return header.substring("bearer ".length()).trim();
    }

    private boolean isConfiguredSecret(String value) {
        String trimmed = trim(value);
        if (trimmed == null || trimmed.isBlank()) {
            return false;
        }
        String lower = trimmed.toLowerCase();
        return !lower.startsWith("your-")
            && !lower.startsWith("replace-with")
            && !lower.equals("changeme");
    }

    private Map<String, Object> inflateJsonFields(Map<String, Object> payload) {
        Map<String, Object> inflated = new HashMap<>(payload);
        for (String key : new String[]{"data", "message", "messages", "payload"}) {
            Object value = inflated.get(key);
            if (!(value instanceof String raw) || raw.isBlank()) {
                continue;
            }
            try {
                Object parsed = objectMapper.readValue(raw, Object.class);
                inflated.put(key, parsed);
            } catch (Exception ignored) {
                // ignore malformed fragments; best-effort only
            }
        }
        log.debug("Webhook form payload normalized keys: {}", inflated.keySet());
        return inflated;
    }

    private static String firstNonBlank(Map<String, String> query, String... keys) {
        for (String key : keys) {
            String value = trim(query.get(key));
            if (!value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
