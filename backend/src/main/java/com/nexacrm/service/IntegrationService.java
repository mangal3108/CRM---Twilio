package com.nexacrm.service;

import com.nexacrm.dto.IntegrationConfigResponse;
import com.nexacrm.model.IntegrationConfig;
import com.nexacrm.repository.IntegrationConfigRepository;
import com.nexacrm.security.CryptoService;
import com.nexacrm.security.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class IntegrationService {

    private static final Map<String, List<String>> REQUIRED_FIELDS = Map.ofEntries(
        Map.entry("facebook", List.of("pageId", "accessToken")),
        Map.entry("instagram", List.of("igAccountId", "accessToken")),
        Map.entry("reddit", List.of("clientId", "clientSecret", "refreshToken", "username")),
        Map.entry("whatsapp", List.of()),
        Map.entry("voice_call_agent", List.of()),
        Map.entry("twilio", List.of("accountSid", "authToken")),
        Map.entry("gmail", List.of("clientId", "clientSecret", "refreshToken")),
        Map.entry("google_calendar", List.of("clientId", "clientSecret")),
        Map.entry("openai", List.of("apiKey")),
        Map.entry("mongodb", List.of("uri")),
        Map.entry("linkedin", List.of("clientId", "clientSecret")),
        Map.entry("google_sheets_leads", List.of("spreadsheetId", "sheetName"))
    );

    private static final Map<String, String> INTEGRATION_ALIASES = Map.of(
        "mistral_ai", "openai",
        "grok_ai", "openai"
    );

    private static final Set<String> SENSITIVE_KEYS = Set.of(
        "apikey", "api_key", "access_token", "token", "secret", "password", "refresh_token", "webhooksecret", "authtoken", "auth_token"
    );

    private final ObjectProvider<LeadService> leadServiceProvider;
    private final IntegrationConfigRepository integrationConfigRepository;
    private final CryptoService cryptoService;
    private final RestTemplate restTemplate;

    private Long tenantId() {
        return TenantContext.currentTenantId();
    }

    public List<IntegrationConfigResponse> getAll() {
        Map<String, IntegrationConfig> byId = new LinkedHashMap<>();
        integrationConfigRepository.findByTenantIdAndDeletedFalse(tenantId())
            .forEach(cfg -> byId.put(normalizeId(cfg.getIntegrationId()), decryptConfig(cfg)));

        List<IntegrationConfigResponse> all = new ArrayList<>();
        REQUIRED_FIELDS.forEach((id, requiredFields) -> all.add(buildResponse(id, requiredFields, byId.get(id))));
        return all;
    }

    public IntegrationConfigResponse getById(String integrationId) {
        String normalizedId = normalizeId(integrationId);
        List<String> required = getRequiredFields(normalizedId);
        IntegrationConfig cfg = findExistingConfig(normalizedId);
        return buildResponse(normalizedId, required, cfg);
    }

    public IntegrationConfigResponse save(String integrationId, Map<String, String> values) {
        String normalizedId = normalizeId(integrationId);
        List<String> required = getRequiredFields(normalizedId);

        IntegrationConfig existing = findExistingConfig(normalizedId);
        Map<String, String> existingValues = existing != null ? safeCopy(existing.getValues()) : Map.of();
        Map<String, String> mergedValues = mergeValues(existingValues, values);
        validateRequired(mergedValues, required);

        IntegrationConfig config = existing != null ? existing : new IntegrationConfig();
        config.setIntegrationId(normalizedId);
        config.setTenantId(tenantId());
        config.setDeleted(false);
        config.setConnected(true);
        config.setValues(encryptSensitiveValues(mergedValues));
        integrationConfigRepository.save(config);

        return buildResponse(normalizedId, required, config);
    }

    public Map<String, Object> test(String integrationId, Map<String, String> values) {
        String normalizedId = normalizeId(integrationId);
        List<String> required = getRequiredFields(normalizedId);

        Map<String, String> persisted = getConfig(normalizedId);
        Map<String, String> testValues = mergeValues(persisted, values);

        validateRequired(testValues, required);

        if ("google_sheets_leads".equals(normalizedId)) {
            return leadService().testPublicGoogleSheetAccess(testValues);
        }
        if ("whatsapp".equals(normalizedId)) {
            return testWhatsAppConnection(testValues);
        }
        if ("twilio".equals(normalizedId)) {
            return testTwilioConnection(testValues);
        }
        if ("openai".equals(normalizedId)) {
            return testOpenAIConnection(testValues);
        }
        if ("mongodb".equals(normalizedId)) {
            return testMongoConnection(testValues);
        }

        return Map.of(
            "ok", true,
            "message", "Connection test passed for " + normalizedId,
            "integration", normalizedId
        );
    }

    public Map<String, Object> sync(String integrationId, Map<String, String> values) {
        String normalizedId = normalizeId(integrationId);
        if (!"google_sheets_leads".equals(normalizedId)) {
            throw new IllegalStateException("Sync is not supported for integration: " + normalizedId);
        }

        Map<String, String> merged = mergeValues(getConfig(normalizedId), values);
        validateRequired(merged, getRequiredFields(normalizedId));
        return leadService().syncFromPublicGoogleSheet(merged);
    }

    public void disconnect(String integrationId) {
        String normalizedId = normalizeId(integrationId);
        IntegrationConfig cfg = findExistingConfig(normalizedId);
        if (cfg != null) {
            cfg.setConnected(false);
            cfg.setValues(new LinkedHashMap<>());
            integrationConfigRepository.save(cfg);
        }
    }

    public boolean isConnected(String integrationId) {
        String normalizedId = normalizeId(integrationId);
        IntegrationConfig cfg = findExistingConfig(normalizedId);
        return cfg != null && Boolean.TRUE.equals(cfg.getConnected());
    }

    public Map<String, String> getConfig(String integrationId) {
        String normalizedId = normalizeId(integrationId);
        IntegrationConfig cfg = findExistingConfig(normalizedId);
        return cfg != null ? safeCopy(cfg.getValues()) : new LinkedHashMap<>();
    }

    private IntegrationConfigResponse buildResponse(String id, List<String> requiredFields, IntegrationConfig cfg) {
        Map<String, String> stored = cfg == null ? new LinkedHashMap<>() : safeCopy(cfg.getValues());
        maskSensitiveValues(stored);

        return IntegrationConfigResponse.builder()
            .id(id)
            .connected(cfg != null && Boolean.TRUE.equals(cfg.getConnected()))
            .requiredFields(requiredFields)
            .values(stored)
            .build();
    }

    private String normalizeId(String integrationId) {
        if (integrationId == null || integrationId.isBlank()) {
            throw new IllegalStateException("Integration id is required.");
        }
        String normalized = integrationId.trim().toLowerCase(Locale.ROOT);
        return INTEGRATION_ALIASES.getOrDefault(normalized, normalized);
    }

    private IntegrationConfig findExistingConfig(String integrationId) {
        String normalizedId = normalizeId(integrationId);
        List<String> candidates = new ArrayList<>();
        candidates.add(normalizedId);
        INTEGRATION_ALIASES.forEach((legacyId, canonicalId) -> {
            if (canonicalId.equals(normalizedId)) {
                candidates.add(legacyId);
            }
        });

        for (String candidate : candidates) {
            IntegrationConfig cfg = integrationConfigRepository
                .findByTenantIdAndIntegrationIdAndDeletedFalse(tenantId(), candidate)
                .orElse(null);
            if (cfg != null) {
                return decryptConfig(cfg);
            }
        }
        return null;
    }

    private IntegrationConfig decryptConfig(IntegrationConfig config) {
        if (config == null) return null;
        Map<String, String> values = safeCopy(config.getValues());
        values.replaceAll((key, value) -> isSensitiveKey(normalizeKey(key)) ? cryptoService.decrypt(value) : value);
        config.setValues(values);
        return config;
    }

    private List<String> getRequiredFields(String integrationId) {
        List<String> required = REQUIRED_FIELDS.get(integrationId);
        if (required == null) {
            throw new IllegalStateException("Unsupported integration: " + integrationId);
        }
        return required;
    }

    private Map<String, Object> testTwilioConnection(Map<String, String> values) {
        String accountSid = trim(values.get("accountSid"));
        String authToken = trim(values.get("authToken"));
        if (accountSid.isBlank() || authToken.isBlank()) {
            throw new IllegalStateException("Twilio Account SID and Auth Token are required.");
        }

        String url = "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + ".json";
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(accountSid, authToken);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                url,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class
            );
            Map<?, ?> body = response.getBody() == null ? Map.of() : response.getBody();
            String friendlyName = trim(String.valueOf(body.get("friendly_name")));
            String status = trim(String.valueOf(body.get("status")));

            List<String> numbers = new ArrayList<>();
            try {
                String numbersUrl = "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/IncomingPhoneNumbers.json";
                ResponseEntity<Map> numResp = restTemplate.exchange(
                    numbersUrl,
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    Map.class
                );
                Map<?, ?> numBody = numResp.getBody() == null ? Map.of() : numResp.getBody();
                Object incomingList = numBody.get("incoming_phone_numbers");
                if (incomingList instanceof List<?> list) {
                    for (Object item : list) {
                        if (item instanceof Map<?, ?> map) {
                            String pn = trim(String.valueOf(map.get("phone_number")));
                            if (!pn.isBlank()) numbers.add(pn);
                        }
                    }
                }
            } catch (Exception ignored) {}

            return Map.of(
                "ok", true,
                "message", "Twilio connected successfully for account: " + (friendlyName.isBlank() ? accountSid : friendlyName) + (numbers.isEmpty() ? "" : " (" + numbers.size() + " active number(s) detected)"),
                "integration", "twilio",
                "accountStatus", status,
                "phoneNumbers", numbers
            );
        } catch (HttpStatusCodeException ex) {
            String errorMsg = ex.getResponseBodyAsString();
            throw new IllegalStateException("Twilio verification failed (HTTP " + ex.getStatusCode().value() + "): " + errorMsg);
        } catch (Exception ex) {
            throw new IllegalStateException("Twilio connection failed: " + ex.getMessage());
        }
    }

    private Map<String, Object> testWhatsAppConnection(Map<String, String> values) {
        String provider = trim(values.get("provider")).toLowerCase(Locale.ROOT);
        String apiToken = firstNonBlank(values.get("apiToken"), values.get("bearerToken"));
        if ("aknexus".equals(provider) || !apiToken.isBlank()) {
            String instanceId = trim(values.get("instanceId"));
            if (apiToken.isBlank() || instanceId.isBlank()) {
                throw new IllegalStateException("AKNexus API Token and Instance ID are required.");
            }

            String baseUrl = normalizeAknexusBaseUrl(values.get("apiUrl"));
            String url = UriComponentsBuilder.fromHttpUrl(baseUrl)
                .pathSegment("whatsapp", "instance", "status", instanceId)
                .toUriString();

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(apiToken);
            try {
                ResponseEntity<Map> response = restTemplate.exchange(
                    url,
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    Map.class
                );
                Map<?, ?> body = response.getBody() == null ? Map.of() : response.getBody();
                Object statusObject = body.get("status");
                String status = trim(statusObject == null ? "" : String.valueOf(statusObject));
                if (!"connected".equalsIgnoreCase(status) && !"success".equalsIgnoreCase(status)) {
                    throw new IllegalStateException("AKNexus instance status is " + (status.isBlank() ? "unknown" : status));
                }
                return Map.of(
                    "ok", true,
                    "message", "AKNexus WhatsApp instance is connected.",
                    "integration", "whatsapp",
                    "provider", "aknexus"
                );
            } catch (HttpStatusCodeException ex) {
                throw new IllegalStateException("AKNexus test failed: " + ex.getResponseBodyAsString());
            }
        }

        return Map.of(
            "ok", true,
            "message", "Connection test passed for whatsapp",
            "integration", "whatsapp"
        );
    }

    private Map<String, Object> testOpenAIConnection(Map<String, String> values) {
        String apiKey = trim(values.get("apiKey"));
        String model = firstNonBlank(values.get("model"), "gpt-4o-mini");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        Map<String, Object> payload = Map.of(
            "model", model,
            "messages", List.of(Map.of("role", "user", "content", "Reply with exactly OK.")),
            "max_tokens", 8,
            "temperature", 0
        );

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                "https://api.openai.com/v1/chat/completions",
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                Map.class
            );
            Map<?, ?> body = response.getBody() == null ? Map.of() : response.getBody();
            if (!(body.get("choices") instanceof List<?> choices) || choices.isEmpty()) {
                throw new IllegalStateException("OpenAI returned no completion choices.");
            }
            return Map.of(
                "ok", true,
                "message", "OpenAI connection test passed.",
                "integration", "openai",
                "model", model
            );
        } catch (HttpStatusCodeException ex) {
            String providerMessage = ex.getResponseBodyAsString();
            if (ex.getStatusCode().value() == 429) {
                throw new IllegalStateException("OpenAI rejected the test because the key is rate limited or has no available quota. Try again later or check the OpenAI dashboard.");
            }
            throw new IllegalStateException("OpenAI connection test failed (HTTP " + ex.getStatusCode().value() + "): " + providerMessage);
        }
    }

    private Map<String, Object> testMongoConnection(Map<String, String> values) {
        String uri = trim(values.get("uri"));
        if (uri.isBlank()) {
            throw new IllegalStateException("MongoDB connection URI is required.");
        }
        String database = trim(values.get("database"));
        if (database.isBlank()) {
            database = "nexacrm";
        }

        try (com.mongodb.client.MongoClient client = com.mongodb.client.MongoClients.create(uri)) {
            com.mongodb.client.MongoDatabase db = client.getDatabase(database);
            long start = System.currentTimeMillis();
            db.runCommand(new org.bson.Document("ping", 1));
            long latencyMs = System.currentTimeMillis() - start;

            List<String> collections = new ArrayList<>();
            for (String colName : db.listCollectionNames()) {
                collections.add(colName);
            }

            return Map.of(
                "ok", true,
                "message", "MongoDB connection verified successfully! Ping latency: " + latencyMs + "ms. Target DB: '" + database + "' (" + collections.size() + " collections found).",
                "integration", "mongodb",
                "database", database,
                "latencyMs", latencyMs,
                "collectionsCount", collections.size()
            );
        } catch (Exception ex) {
            throw new IllegalStateException("MongoDB connection test failed: " + ex.getMessage());
        }
    }

    private String normalizeAknexusBaseUrl(String raw) {
        String baseUrl = trim(raw);
        if (baseUrl.isBlank()) {
            baseUrl = "https://app.aknexus.in/api/v2";
        }
        while (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        if (!baseUrl.endsWith("/api/v2")) {
            baseUrl = baseUrl + "/api/v2";
        }
        return baseUrl;
    }

    private void validateRequired(Map<String, String> values, List<String> requiredFields) {
        List<String> missing = requiredFields.stream()
            .filter(field -> trim(values.get(field)).isBlank())
            .toList();

        if (!missing.isEmpty()) {
            throw new IllegalStateException("Missing required fields: " + String.join(", ", missing));
        }
    }

    private Map<String, String> mergeValues(Map<String, String> existing, Map<String, String> incoming) {
        Map<String, String> merged = safeCopy(existing);
        if (incoming == null || incoming.isEmpty()) {
            return merged;
        }

        Set<String> knownSensitive = new HashSet<>();
        incoming.forEach((key, value) -> {
            String normalizedKey = normalizeKey(key);
            String clean = trim(value);
            if (isSensitiveKey(normalizedKey)) {
                knownSensitive.add(key);
                if (clean.isBlank() || isMaskedValue(clean)) {
                    if (existing.containsKey(key)) {
                        merged.put(key, trim(existing.get(key)));
                    }
                } else {
                    merged.put(key, clean);
                }
                return;
            }
            merged.put(key, clean);
        });

        existing.forEach((key, value) -> {
            if (knownSensitive.contains(key) && !merged.containsKey(key)) {
                merged.put(key, trim(value));
            }
        });

        return merged;
    }

    private Map<String, String> encryptSensitiveValues(Map<String, String> values) {
        Map<String, String> encrypted = new LinkedHashMap<>();
        values.forEach((key, value) -> {
            String clean = trim(value);
            if (isSensitiveKey(normalizeKey(key))) {
                encrypted.put(key, cryptoService.encrypt(clean));
            } else {
                encrypted.put(key, clean);
            }
        });
        return encrypted;
    }

    private void maskSensitiveValues(Map<String, String> values) {
        values.replaceAll((key, value) -> {
            if (!isSensitiveKey(normalizeKey(key))) {
                return value;
            }
            return maskValue(value);
        });
    }

    private boolean isSensitiveKey(String normalizedKey) {
        return SENSITIVE_KEYS.stream().anyMatch(normalizedKey::contains);
    }

    private String normalizeKey(String key) {
        return trim(key).toLowerCase(Locale.ROOT);
    }

    private String maskValue(String value) {
        String v = trim(value);
        if (v.isBlank()) {
            return "";
        }
        if (v.length() <= 4) {
            return "****";
        }
        return "********" + v.substring(v.length() - 4);
    }

    private boolean isMaskedValue(String value) {
        String v = trim(value);
        return v.startsWith("****");
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            String normalized = trim(value);
            if (!normalized.isBlank()) {
                return normalized;
            }
        }
        return "";
    }

    private Map<String, String> safeCopy(Map<String, String> source) {
        Map<String, String> copy = new LinkedHashMap<>();
        if (source == null) {
            return copy;
        }
        source.forEach((k, v) -> copy.put(k, trim(v)));
        return copy;
    }

    private String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private LeadService leadService() {
        return leadServiceProvider.getObject();
    }
}
