package com.nexacrm.service;

import com.nexacrm.dto.EmailSendRequest;
import com.nexacrm.dto.WhatsAppConversationResponse;
import com.nexacrm.dto.WhatsAppMessageResponse;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nexacrm.model.CommunicationRecord;
import com.nexacrm.model.Customer;
import com.nexacrm.model.Lead;
import com.nexacrm.repository.CommunicationRecordRepository;
import com.nexacrm.repository.CustomerRepository;
import com.nexacrm.repository.LeadRepository;
import com.nexacrm.repository.TenantRepository;
import com.nexacrm.security.TenantContext;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class CommunicationService {

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    public record VoiceCallProviderResult(
        String status,
        String outcome,
        Integer durationSeconds,
        String externalId
    ) {}

    public record VoiceCallDetails(
        String status,
        String outcome,
        Integer durationSeconds,
        String externalId,
        String transcript,
        String recordingUrl,
        String summary
    ) {}

    private final JavaMailSender mailSender;
    private final IntegrationService integrationService;
    private final CommunicationRecordRepository communicationRecordRepository;
    private final LeadRepository leadRepository;
    private final CustomerRepository customerRepository;
    private final TenantRepository tenantRepository;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final Map<String, String> facebookNameCache = new ConcurrentHashMap<>();
    private final Map<String, String> instagramNameCache = new ConcurrentHashMap<>();

    @Value("${spring.mail.username}")
    private String smtpFrom;

    @Value("${spring.mail.host:}")
    private String smtpHost;

    @Value("${spring.mail.password:}")
    private String smtpPassword;

    @Value("${nexacrm.whatsapp.aiadrika-base-url:https://aiadrika.in/api/send}")
    private String aiadrikaBaseUrl;

    @Value("${nexacrm.whatsapp.aiadrika.instance-id:}")
    private String defaultInstanceId;

    @Value("${nexacrm.whatsapp.aiadrika.access-token:}")
    private String defaultAccessToken;

    @Value("${nexacrm.whatsapp.aknexus.api-url:https://app.aknexus.in/api/v2}")
    private String defaultAknexusApiUrl;

    @Value("${nexacrm.whatsapp.aknexus.api-token:}")
    private String defaultAknexusApiToken;

    @Value("${nexacrm.whatsapp.aknexus.instance-id:}")
    private String defaultAknexusInstanceId;

    @Value("${meta.page-access-token:}")
    private String defaultFacebookPageAccessToken;

    @Value("${meta.graph-api-version:v19.0}")
    private String metaGraphApiVersion;

    @Value("${meta.facebook.out-of-window.retry-with-message-tag:false}")
    private boolean retryFacebookOutOfWindowWithMessageTag;

    @Value("${meta.facebook.message-tag:HUMAN_AGENT}")
    private String facebookMessageTag;

    @Value("${nexacrm.auto-reply.enabled:true}")
    private boolean autoReplyEnabled;

    @Value("${nexacrm.auto-reply.message:Thanks for messaging NexaCRM! We received your message and will get back to you shortly.}")
    private String autoReplyMessage;

    @Value("${nexacrm.call-agent.enabled:false}")
    private boolean defaultCallAgentEnabled;

    @Value("${nexacrm.call-agent.auto-call-on-lead-create:false}")
    private boolean defaultAutoCallOnLeadCreate;

    @Value("${nexacrm.call-agent.webhook-url:}")
    private String defaultCallAgentWebhookUrl;

    @Value("${nexacrm.call-agent.api-key:}")
    private String defaultCallAgentApiKey;

    @Value("${nexacrm.call-agent.agent-id:}")
    private String defaultCallAgentAgentId;

    @Value("${nexacrm.call-agent.from-number:}")
    private String defaultCallAgentFromNumber;

    @Value("${nexacrm.call-agent.timeout-ms:12000}")
    private int callAgentTimeoutMs;

    @Value("${nexacrm.call-agent.provider:bolna}")
    private String defaultCallAgentProvider;

    @Value("${nexacrm.webhooks.default-tenant-id:1}")
    private Long defaultWebhookTenantId;

    private Long tenantId() {
        return TenantContext.currentTenantId();
    }

    @Value("${nexacrm.call-agent.bolna.api-url:https://api.bolna.ai}")
    private String defaultBolnaApiUrl;

    @Value("${nexacrm.call-agent.bolna.api-key:}")
    private String defaultBolnaApiKey;

    @Value("${nexacrm.call-agent.bolna.agent-id:}")
    private String defaultBolnaAgentId;

    @Value("${nexacrm.call-agent.bolna.voice-id:}")
    private String defaultBolnaVoiceId;

    @Value("${nexacrm.call-agent.callback-webhook-url:}")
    private String defaultCallAgentCallbackWebhookUrl;

    @Value("${nexacrm.twilio.account-sid:}")
    private String defaultTwilioAccountSid;

    @Value("${nexacrm.twilio.auth-token:}")
    private String defaultTwilioAuthToken;

    @Value("${nexacrm.twilio.phone-numbers:}")
    private String defaultTwilioPhoneNumbers;

    @Value("${nexacrm.twilio.default-from-number:}")
    private String defaultTwilioDefaultFromNumber;

    public void sendEmail(EmailSendRequest request) {
        validateSmtpConfiguration();
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
            helper.setFrom(smtpFrom);
            helper.setTo(request.getTo().trim());
            helper.setSubject(request.getSubject().trim());
            helper.setText(request.getBody().trim(), false);
            mailSender.send(message);
            notifyOutboundCommunication(
                "email",
                request.getTo(),
                combineEmailPreview(request.getSubject(), request.getBody())
            );
            log.info("Email sent to {}", request.getTo());
        } catch (MailAuthenticationException ex) {
            log.error("SMTP authentication failed", ex);
            throw new IllegalStateException(
                "SMTP authentication failed. Verify you are using a current App Password generated for this same Gmail account."
            );
        } catch (MailSendException ex) {
            log.error("SMTP send failed: {}", ex.getMessage());
            throw new IllegalStateException("Failed to send email. Check recipient and SMTP settings.");
        } catch (MessagingException ex) {
            log.error("Email compose failed: {}", ex.getMessage());
            throw new IllegalStateException("Failed to compose email message.");
        }
    }

    private void validateSmtpConfiguration() {
        String host = trim(smtpHost).toLowerCase(Locale.ROOT);
        if (!host.contains("gmail.com")) {
            return;
        }

        String password = trim(smtpPassword).replace(" ", "");
        if (password.isBlank() || password.length() != 16) {
            throw new IllegalStateException(
                "Gmail SMTP requires a 16-character App Password. Current configured password length="
                    + password.length()
                    + ". Generate it in Google Account > Security > 2-Step Verification > App passwords."
            );
        }
    }

    public void sendChannelMessage(@NonNull String channel, @NonNull String recipient, String subject, @NonNull String body) {
        String normalizedChannel = channel.trim().toLowerCase(Locale.ROOT);
        switch (normalizedChannel) {
            case "email", "gmail" -> {
                EmailSendRequest emailRequest = new EmailSendRequest();
                emailRequest.setTo(recipient);
                emailRequest.setSubject(normalizeSubject(subject));
                emailRequest.setBody(body);
                sendEmail(emailRequest);
                tryPersistCommunication(
                    "EMAIL",
                    "OUT",
                    recipient,
                    body,
                    "SENT",
                    null,
                    "{\"subject\":\"" + normalizeSubject(subject).replace("\"", "\\\"") + "\"}",
                    "smtp"
                );
            }
            case "call", "voice", "voice_call" -> sendVoiceCall(
                resolveVoiceAgentConfig(),
                recipient,
                body,
                "manual_send",
                Map.of("channel", "call")
            );
            case "whatsapp", "instagram", "facebook", "linkedin", "reddit" -> sendSocialMessage(normalizedChannel, recipient, body);
            default -> throw new IllegalStateException("Unsupported channel: " + normalizedChannel);
        }
    }

    public void sendWhatsAppDocument(@NonNull String recipient, @NonNull byte[] document, @NonNull String fileName, String caption) {
        sendWhatsAppDocument(recipient, document, fileName, caption, null);
    }

    public void sendWhatsAppDocument(
        @NonNull String recipient,
        @NonNull byte[] document,
        @NonNull String fileName,
        String caption,
        String mediaUrl
    ) {
        String number = recipient.replaceAll("\\D", "");
        if (number.isBlank()) {
            throw new IllegalStateException("Invalid WhatsApp number.");
        }

        Map<String, String> config = integrationService.getConfig("whatsapp");
        String provider = trim(config.get("provider")).toLowerCase(Locale.ROOT);
        String aknexusToken = firstNonBlank(config.get("apiToken"), config.get("bearerToken"), defaultAknexusApiToken);
        if ("aknexus".equals(provider)
            || (!aknexusToken.isBlank() && !"aiadrika".equals(provider) && !"kriscelwa".equals(provider))) {
            sendViaAknexusWhatsAppDocument(number, document, fileName, caption, mediaUrl, config, aknexusToken);
            return;
        }

        throw new IllegalStateException("WhatsApp PDF sending requires the AKNexus provider to be connected.");
    }

    public void sendLeadVoiceCall(
        String leadId,
        String leadName,
        String leadPhone,
        String script,
        String triggerSource,
        Map<String, Object> metadata
    ) {
        Map<String, Object> mergedMetadata = new LinkedHashMap<>();
        if (metadata != null && !metadata.isEmpty()) {
            mergedMetadata.putAll(metadata);
        }
        if (!trim(leadId).isBlank()) {
            mergedMetadata.put("leadId", trim(leadId));
        }
        if (!trim(leadName).isBlank()) {
            mergedMetadata.put("leadName", trim(leadName));
        }
        Long currentTenantId = TenantContext.currentTenantIdOrNull();
        if (currentTenantId != null) {
            mergedMetadata.put("tenantId", currentTenantId);
        }
        sendVoiceCall(
            resolveVoiceAgentConfig(),
            leadPhone,
            script,
            trim(triggerSource).isBlank() ? "manual_lead_call" : triggerSource,
            mergedMetadata
        );
    }

    @Transactional(readOnly = true)
    public Optional<VoiceCallProviderResult> fetchLatestLeadCallProviderResult(String leadId) {
        String normalizedLeadId = trim(leadId);
        if (normalizedLeadId.isBlank()) {
            return Optional.empty();
        }

        List<CommunicationRecord> calls = communicationRecordRepository
            .findTop50ByTenantIdAndLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(
                TenantContext.currentTenantId(),
                normalizedLeadId,
                "CALL"
            );

        for (CommunicationRecord call : calls) {
            String provider = trim(call.getProvider()).toLowerCase(Locale.ROOT);
            String externalId = trim(call.getExternalId());
            if (!"bolna".equals(provider) || externalId.isBlank()) {
                continue;
            }

            Map<String, Object> execution = fetchBolnaExecutionDetails(externalId);
            if (execution.isEmpty()) {
                continue;
            }

            String status = findFirstTextByKeys(execution, List.of(
                "status",
                "call_status",
                "callStatus",
                "state",
                "execution_status",
                "executionStatus",
                "telephony_status",
                "telephonyStatus"
            ));
            String outcome = findFirstTextByKeys(execution, List.of(
                "outcome",
                "call_outcome",
                "callOutcome",
                "disposition",
                "result",
                "answered_by",
                "answeredBy"
            ));
            Integer durationSeconds = firstInteger(findFirstTextByKeys(execution, List.of(
                "durationSeconds",
                "duration_seconds",
                "callDurationSeconds",
                "call_duration_seconds",
                "duration"
            )));

            if (!status.isBlank() || !outcome.isBlank() || durationSeconds != null) {
                return Optional.of(new VoiceCallProviderResult(status, outcome, durationSeconds, externalId));
            }
        }

        return Optional.empty();
    }

    @Transactional
    public Optional<VoiceCallDetails> syncVoiceCallDetails(CommunicationRecord call) {
        if (call == null || !"CALL".equalsIgnoreCase(trim(call.getChannel()))) {
            return Optional.empty();
        }

        String provider = trim(call.getProvider()).toLowerCase(Locale.ROOT);
        String externalId = trim(call.getExternalId());
        Object rawRoot = readJsonObject(call.getRawPayload());

        String transcript = extractTranscriptFromNode(rawRoot);
        String recordingUrl = findFirstTextByKeys(rawRoot, List.of("recording_url", "recordingUrl", "recording"));
        String summary = firstNonBlank(
            findFirstTextByKeys(rawRoot, List.of("summary", "call_summary", "callSummary", "note", "description")),
            transcript.length() > 320 ? transcript.substring(0, 320) + "..." : transcript
        );
        String status = firstNonBlank(
            findFirstTextByKeys(rawRoot, List.of("status", "call_status", "callStatus", "state", "execution_status", "executionStatus")),
            call.getStatus()
        );
        String outcome = findFirstTextByKeys(rawRoot, List.of("outcome", "call_outcome", "callOutcome", "disposition", "result", "answered_by", "answeredBy"));
        Integer durationSeconds = firstInteger(findFirstTextByKeys(rawRoot, List.of("durationSeconds", "duration_seconds", "callDurationSeconds", "call_duration_seconds", "duration")));

        Map<String, Object> bolnaExecution = Map.of();
        if ("bolna".equals(provider) && !externalId.isBlank()
            && (transcript.isBlank() || recordingUrl.isBlank() || summary.isBlank() || isQueuedLike(status))) {
            bolnaExecution = fetchBolnaExecutionDetails(externalId);
            if (!bolnaExecution.isEmpty()) {
                transcript = firstNonBlank(extractTranscriptFromNode(bolnaExecution), transcript);
                recordingUrl = firstNonBlank(
                    findFirstTextByKeys(bolnaExecution, List.of("recording_url", "recordingUrl", "recording")),
                    recordingUrl
                );
                summary = firstNonBlank(
                    findFirstTextByKeys(bolnaExecution, List.of("summary", "call_summary", "callSummary", "note", "description")),
                    summary
                );
                status = firstNonBlank(
                    findFirstTextByKeys(bolnaExecution, List.of("status", "call_status", "callStatus", "state", "execution_status", "executionStatus")),
                    status
                );
                outcome = firstNonBlank(
                    findFirstTextByKeys(bolnaExecution, List.of("outcome", "call_outcome", "callOutcome", "disposition", "result", "answered_by", "answeredBy")),
                    outcome
                );
                durationSeconds = firstNonNull(
                    firstInteger(findFirstTextByKeys(bolnaExecution, List.of("durationSeconds", "duration_seconds", "callDurationSeconds", "call_duration_seconds", "duration"))),
                    durationSeconds
                );
            }
        }

        if (summary.isBlank() && !transcript.isBlank()) {
            summary = transcript.length() > 320 ? transcript.substring(0, 320) + "..." : transcript;
        }

        if (!bolnaExecution.isEmpty() || !transcript.isBlank() || !recordingUrl.isBlank()) {
            Map<String, Object> enriched = rawRoot instanceof Map<?, ?> map ? new LinkedHashMap<>() : new LinkedHashMap<>();
            if (rawRoot instanceof Map<?, ?> map) {
                map.forEach((key, value) -> enriched.put(String.valueOf(key), value));
            }
            if (!bolnaExecution.isEmpty()) enriched.put("bolnaExecution", bolnaExecution);
            if (!transcript.isBlank()) enriched.put("transcript", transcript);
            if (!recordingUrl.isBlank()) enriched.put("recordingUrl", recordingUrl);
            if (!summary.isBlank()) enriched.put("summary", summary);
            if (!outcome.isBlank()) enriched.put("outcome", outcome);
            if (durationSeconds != null) enriched.put("durationSeconds", durationSeconds);
            call.setRawPayload(toJsonSafe(enriched));
            if (!status.isBlank() && !isQueuedLike(status)) {
                call.setStatus(normalizeCallStatus(status));
            }
            communicationRecordRepository.save(call);
        }

        return Optional.of(new VoiceCallDetails(
            normalizeCallStatus(status),
            outcome,
            durationSeconds,
            externalId,
            transcript,
            recordingUrl,
            summary
        ));
    }

    public void cancelPendingLeadVoiceCalls(String leadId) {
        cancelPendingLeadVoiceCalls(leadId, "");
    }

    public void cancelPendingLeadVoiceCalls(String leadId, String executionId) {
        Set<String> executionIds = new LinkedHashSet<>();
        String normalizedExecutionId = trim(executionId);
        if (!normalizedExecutionId.isBlank()) {
            executionIds.add(normalizedExecutionId);
        }

        String normalizedLeadId = trim(leadId);
        if (!normalizedLeadId.isBlank()) {
            List<CommunicationRecord> calls = communicationRecordRepository
                .findTop50ByTenantIdAndLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(
                    TenantContext.currentTenantId(),
                    normalizedLeadId,
                    "CALL"
                );
            calls.stream()
                .filter(call -> "bolna".equals(trim(call.getProvider()).toLowerCase(Locale.ROOT)))
                .filter(call -> isQueuedLike(call.getStatus()))
                .map(CommunicationRecord::getExternalId)
                .map(this::trim)
                .filter(id -> !id.isBlank())
                .forEach(executionIds::add);
        }

        executionIds.forEach(this::stopBolnaExecution);
    }

    public void autoCallNewLeadAsync(
        String leadId,
        String leadName,
        String leadPhone,
        String company,
        String service,
        String assignedToName
    ) {
        autoCallNewLeadAsync(leadId, leadName, leadPhone, company, service, assignedToName, TenantContext.currentTenantId());
    }

    @Async
    public void autoCallNewLeadAsync(
        String leadId,
        String leadName,
        String leadPhone,
        String company,
        String service,
        String assignedToName,
        Long tenantId
    ) {
        if (tenantId != null) TenantContext.setCurrentTenantId(tenantId);
        try {
            VoiceAgentConfig config = resolveVoiceAgentConfig();
            if (!config.enabled() || !config.autoCallOnLeadCreate()) {
                return;
            }
            if (trim(leadPhone).isBlank()) {
                log.info("Auto-call skipped for lead {} because phone number is missing", trim(leadId));
                return;
            }

            String script = buildLeadCallScript(leadName, company, service);
            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("leadId", trim(leadId));
            metadata.put("leadName", trim(leadName));
            metadata.put("company", trim(company));
            metadata.put("service", trim(service));
            metadata.put("assignedTo", trim(assignedToName));
            metadata.put("trigger", "LEAD_CREATED");

            sendLeadVoiceCall(leadId, leadName, leadPhone, script, "lead_auto_call", metadata);
            log.info("Auto-call queued for lead {}", trim(leadId));
        } catch (Exception ex) {
            log.warn("Auto-call failed for lead {}: {}", trim(leadId), ex.getMessage());
        } finally {
            TenantContext.clear();
        }
    }

    public void autoWhatsAppNewLeadAsync(String leadId, String leadName, String leadPhone,
            String company, String service, String source) {
        autoWhatsAppNewLeadAsync(leadId, leadName, leadPhone, company, service, source,
                TenantContext.currentTenantId());
    }

    @Async
    public void autoWhatsAppNewLeadAsync(String leadId, String leadName, String leadPhone,
            String company, String service, String source, Long tenantId) {
        if (tenantId != null) TenantContext.setCurrentTenantId(tenantId);
        try {
            if (trim(leadPhone).isBlank()) {
                log.info("Auto-WhatsApp skipped for lead {} because phone number is missing", trim(leadId));
                return;
            }
            String message = String.join("\n",
                "🚀 *KRISCEL TECH PVT. LTD.*",
                "*Smart Technology. Automated Business. Digital Growth.*",
                "",
                "Transform your business with *smart automation & digital marketing solutions* that help you *save time, improve efficiency & grow faster.*",
                "",
                "⚙️ *BUSINESS AUTOMATION*",
                "CRM • Inventory • Production • Purchase • HR • Custom Solutions",
                "",
                "📈 *DIGITAL GROWTH*",
                "SEO • Performance Marketing • Social Media • Branding • Lead Generation • E-commerce",
                "",
                "✨ *Why Kriscel?*",
                "✅ Automate & streamline operations",
                "✅ Improve business efficiency",
                "✅ Grow your online presence",
                "✅ Generate quality leads",
                "",
                "📩 *Tell us your requirement — we’ll suggest the right solution!*",
                "",
                "🌐 *Website:* https://kriscel.com/",
                "📁 *Portfolio:* https://drive.google.com/file/d/1ZPtJS1yPIFev2XymUHlClL1l7tFgEVYH/view?usp=sharing",
                "📘 *Facebook:* https://www.facebook.com/KriscelTech",
                "📸 *Instagram:* https://www.instagram.com/krisceltech/",
                "🔗 *LinkedIn:* https://www.linkedin.com/company/kriscel-tech-pvt-ltd/?originalSubdomain=in",
                "",
                "📞 *+91 89854 19420*",
                "",
                "🚀 *Let’s Automate. Optimize. Grow.*",
                "*Kriscel Tech Pvt. Ltd.*"
            );

            sendChannelMessage("whatsapp", leadPhone, "", message);
            log.info("Auto-WhatsApp welcome sent to lead {}", trim(leadId));
        } catch (Exception ex) {
            log.warn("Auto-WhatsApp failed for lead {}: {}", trim(leadId), ex.getMessage());
        } finally {
            TenantContext.clear();
        }
    }

    @Async
    public void sendAdminNewLeadNotificationAsync(String leadId, String leadName, String leadPhone,
            String leadEmail, String company, String service, String source, String dealValue, Long tenantId) {
        if (tenantId != null) TenantContext.setCurrentTenantId(tenantId);
        try {
            java.util.List<String> adminPhones = resolveAdminNotificationPhones();
            if (adminPhones.isEmpty()) {
                log.debug("Admin new-lead WhatsApp skipped — no admin notification phone configured");
                return;
            }

            String now = java.time.LocalDateTime.now(java.time.ZoneId.of("Asia/Kolkata"))
                .format(java.time.format.DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a"));

            StringBuilder msg = new StringBuilder();
            msg.append("🔔 *NEW LEAD ALERT*\n");
            msg.append("━━━━━━━━━━━━━━━━━━━━━━\n");
            msg.append("📅 ").append(now).append("\n\n");

            msg.append("👤 *Lead Details:*\n");
            if (!trim(leadName).isBlank()) msg.append("• Name: *").append(trim(leadName)).append("*\n");
            if (!trim(leadPhone).isBlank()) msg.append("• Phone: ").append(trim(leadPhone)).append("\n");
            if (!trim(leadEmail).isBlank()) msg.append("• Email: ").append(trim(leadEmail)).append("\n");
            if (!trim(company).isBlank()) msg.append("• Company: ").append(trim(company)).append("\n");
            if (!trim(service).isBlank()) msg.append("• Requirement: ").append(trim(service)).append("\n");
            if (!trim(dealValue).isBlank()) msg.append("• Budget: ₹").append(trim(dealValue)).append("\n");
            if (!trim(source).isBlank()) msg.append("• Source: ").append(trim(source)).append("\n");
            msg.append("\n");

            msg.append("⚡ *Automated Actions:*\n");
            msg.append("✅ AI Call initiated\n");
            msg.append("✅ WhatsApp welcome sent to lead\n");
            msg.append("✅ Lead added to CRM pipeline\n\n");

            msg.append("📌 *Status:* NEW\n");
            msg.append("🤖 AI will analyze the call and send you a detailed report after the conversation.\n\n");

            msg.append("━━━━━━━━━━━━━━━━━━━━━━\n");
            msg.append("_NexaCRM Lead Alert_");

            String message = msg.toString();
            for (String adminPhone : adminPhones) {
                try {
                    sendChannelMessage("whatsapp", adminPhone, "", message);
                    log.info("Admin new-lead WhatsApp sent for lead {} to {}", trim(leadId), adminPhone);
                } catch (Exception phoneEx) {
                    log.warn("Admin new-lead WhatsApp failed for lead {} to {}: {}", trim(leadId), adminPhone, phoneEx.getMessage());
                }
            }
        } catch (Exception ex) {
            log.warn("Admin new-lead WhatsApp failed for lead {}: {}", trim(leadId), ex.getMessage());
        } finally {
            TenantContext.clear();
        }
    }

    private java.util.List<String> resolveAdminNotificationPhones() {
        String configPhone = trim(integrationService.getConfig("voice_call_agent").get("adminNotificationPhone"));
        java.util.List<String> phones = new java.util.ArrayList<>();
        if (!configPhone.isBlank()) {
            for (String p : configPhone.split("[,;\\s]+")) {
                String cleaned = trim(p);
                if (!cleaned.isBlank()) phones.add(cleaned);
            }
        }
        if (phones.isEmpty()) {
            Long currentTenantId = TenantContext.currentTenantIdOrNull();
            if (currentTenantId != null) {
                tenantRepository.findByTenantIdAndDeletedFalse(currentTenantId)
                    .map(t -> trim(t.getContactPhone()))
                    .filter(p -> !p.isBlank())
                    .ifPresent(phones::add);
            }
        }
        return phones;
    }

    public List<WhatsAppMessageResponse> getWhatsAppMessages(@NonNull String contact) {
        String normalizedContact = normalizeContact(contact);
        return communicationRecordRepository
            .findTop500ByTenantIdAndChannelIgnoreCaseAndContactIdentifierOrderByCreatedAtAsc(tenantId(), "WHATSAPP", normalizedContact)
            .stream()
            .map(this::toMessageResponse)
            .toList();
    }

    public List<WhatsAppConversationResponse> getWhatsAppConversations() {
        List<CommunicationRecord> rows = communicationRecordRepository.findByTenantIdAndChannelIgnoreCaseOrderByCreatedAtDesc(
            tenantId(),
            "WHATSAPP",
            PageRequest.of(0, 1000)
        );

        Map<String, CommunicationRecord> latestByContact = new LinkedHashMap<>();
        for (CommunicationRecord row : rows) {
            String contact = trim(row.getContactIdentifier());
            if (contact.isBlank()) {
                continue;
            }
            latestByContact.putIfAbsent(contact, row);
        }

        return latestByContact.values().stream()
            .map(row -> WhatsAppConversationResponse.builder()
                .contact(row.getContactIdentifier())
                .name(resolveWhatsAppDisplayName(row))
                .lastMessage(row.getBody())
                .lastDirection(row.getDirection())
                .lastAt(asUtcOffsetDateTime(row.getCreatedAt()))
                .build())
            .sorted(Comparator.comparing(
                (WhatsAppConversationResponse c) -> c.getLastAt() == null ? OffsetDateTime.MIN : c.getLastAt()
            ).reversed())
            .toList();
    }

    // ── Facebook Messenger ────────────────────────────────────────

    @Async
    public void processFacebookMessengerWebhookAsync(String rawBody) {
        try {
            JsonNode root = objectMapper.readTree(rawBody);
            JsonNode entries = root.path("entry");
            if (!entries.isArray()) return;

            int saved = 0;
            Map<String, String> localNameCache = new HashMap<>();
            for (JsonNode entry : entries) {
                JsonNode messaging = entry.path("messaging");
                if (!messaging.isArray()) continue;
                for (JsonNode event : messaging) {
                    String psid = trim(event.at("/sender/id").asText(""));
                    JsonNode msgNode = event.path("message");
                    if (psid.isBlank() || msgNode.isMissingNode()) continue;
                    if (msgNode.path("is_echo").asBoolean(false)) continue;

                    String text = trim(msgNode.path("text").asText(""));
                    String mid  = trim(msgNode.path("mid").asText(""));
                    if (text.isBlank()) continue;
                    if (isDuplicateInboundEvent("FACEBOOK", mid)) {
                        continue;
                    }
                    String displayName = localNameCache.computeIfAbsent(psid, this::resolveFacebookProfileName);

                    boolean persisted = tryPersistCommunication(
                        "FACEBOOK", "IN", psid, text, "RECEIVED", mid, toJson(event), "facebook_messenger", displayName
                    );
                    if (persisted) {
                        saved++;
                        notificationService.notifyInboundMessage("facebook", displayName, text);
                        sendAutoReplySafely("facebook", psid);
                    }
                }
            }
            log.info("Facebook Messenger webhook processed, inbound saved={}", saved);
        } catch (Exception e) {
            log.error("Error processing Facebook Messenger webhook", e);
        }
    }

    public List<WhatsAppMessageResponse> getFacebookMessages(String psid) {
        String normalizedPsid = psid == null ? "" : psid.trim().replaceAll("\\D", "");
        return communicationRecordRepository
            .findTop500ByTenantIdAndChannelIgnoreCaseAndContactIdentifierOrderByCreatedAtAsc(tenantId(), "FACEBOOK", normalizedPsid)
            .stream()
            .map(this::toMessageResponse)
            .toList();
    }

    public List<WhatsAppConversationResponse> getFacebookConversations() {
        List<CommunicationRecord> rows = communicationRecordRepository.findByTenantIdAndChannelIgnoreCaseOrderByCreatedAtDesc(
            tenantId(),
            "FACEBOOK", PageRequest.of(0, 1000)
        );

        Map<String, CommunicationRecord> latestByContact = new LinkedHashMap<>();
        for (CommunicationRecord row : rows) {
            String contact = trim(row.getContactIdentifier());
            if (contact.isBlank()) continue;
            latestByContact.putIfAbsent(contact, row);
        }

        return latestByContact.values().stream()
            .map(row -> WhatsAppConversationResponse.builder()
                .contact(row.getContactIdentifier())
                .name(resolveFacebookDisplayName(row))
                .lastMessage(row.getBody())
                .lastDirection(row.getDirection())
                .lastAt(asUtcOffsetDateTime(row.getCreatedAt()))
                .build())
            .sorted(Comparator.comparing(
                (WhatsAppConversationResponse c) -> c.getLastAt() == null ? OffsetDateTime.MIN : c.getLastAt()
            ).reversed())
            .toList();
    }

    // ── Instagram Messaging ──────────────────────────────────────

    @Async
    public void processInstagramMessengerWebhookAsync(String rawBody) {
        try {
            JsonNode root = objectMapper.readTree(rawBody);
            JsonNode entries = root.path("entry");
            if (!entries.isArray()) return;

            int saved = 0;
            for (JsonNode entry : entries) {
                JsonNode messaging = entry.path("messaging");
                if (!messaging.isArray()) continue;
                for (JsonNode event : messaging) {
                    String igsid = trim(event.at("/sender/id").asText(""));
                    JsonNode msgNode = event.path("message");
                    if (igsid.isBlank() || msgNode.isMissingNode()) continue;
                    if (msgNode.path("is_echo").asBoolean(false)) continue;

                    String text = trim(msgNode.path("text").asText(""));
                    String mid = trim(msgNode.path("mid").asText(""));
                    if (text.isBlank()) continue;
                    if (isDuplicateInboundEvent("INSTAGRAM", mid)) {
                        continue;
                    }

                    String displayName = extractInstagramDisplayName(event, igsid);
                    boolean persisted = tryPersistCommunication(
                        "INSTAGRAM",
                        "IN",
                        igsid,
                        text,
                        "RECEIVED",
                        mid,
                        toJson(event),
                        "instagram_messaging",
                        displayName
                    );
                    if (persisted) {
                        saved++;
                        notificationService.notifyInboundMessage("instagram", displayName, text);
                        sendAutoReplySafely("instagram", igsid);
                    }
                }
            }
            log.info("Instagram webhook processed, inbound saved={}", saved);
        } catch (Exception e) {
            log.error("Error processing Instagram webhook", e);
        }
    }

    public List<WhatsAppMessageResponse> getInstagramMessages(String igsid) {
        String normalizedIgsid = trim(igsid);
        return communicationRecordRepository
            .findTop500ByTenantIdAndChannelIgnoreCaseAndContactIdentifierOrderByCreatedAtAsc(tenantId(), "INSTAGRAM", normalizedIgsid)
            .stream()
            .map(this::toMessageResponse)
            .toList();
    }

    public List<WhatsAppConversationResponse> getInstagramConversations() {
        List<CommunicationRecord> rows = communicationRecordRepository.findByTenantIdAndChannelIgnoreCaseOrderByCreatedAtDesc(
            tenantId(),
            "INSTAGRAM",
            PageRequest.of(0, 1000)
        );

        Map<String, CommunicationRecord> latestByContact = new LinkedHashMap<>();
        for (CommunicationRecord row : rows) {
            String contact = trim(row.getContactIdentifier());
            if (contact.isBlank()) continue;
            latestByContact.putIfAbsent(contact, row);
        }

        return latestByContact.values().stream()
            .map(row -> WhatsAppConversationResponse.builder()
                .contact(row.getContactIdentifier())
                .name(resolveInstagramDisplayName(row))
                .lastMessage(row.getBody())
                .lastDirection(row.getDirection())
                .lastAt(asUtcOffsetDateTime(row.getCreatedAt()))
                .build())
            .sorted(Comparator.comparing(
                (WhatsAppConversationResponse c) -> c.getLastAt() == null ? OffsetDateTime.MIN : c.getLastAt()
            ).reversed())
            .toList();
    }

    public Map<String, Object> processWhatsAppWebhook(Map<String, Object> payload) {
        boolean tenantWasMissing = TenantContext.currentTenantIdOrNull() == null;
        if (tenantWasMissing) {
            TenantContext.setCurrentTenantId(defaultWebhookTenantId);
        }

        try {
            JsonNode root = objectMapper.valueToTree(payload);
            List<JsonNode> candidates = collectCandidates(root);
            int saved = 0;

            for (JsonNode candidate : candidates) {
                String contact = extractContact(candidate);
                String text = extractText(candidate);
                String direction = extractDirection(candidate);
                String externalId = extractExternalId(candidate);
                String status = extractStatus(candidate);

                if (contact.isBlank() || text.isBlank()) {
                    continue;
                }
                if (!"IN".equals(direction)) {
                    continue;
                }
                if (isDuplicateInboundEvent("WHATSAPP", externalId)) {
                    continue;
                }

                boolean persisted = tryPersistCommunication(
                    "WHATSAPP",
                    direction,
                    contact,
                    text,
                    status,
                    externalId,
                    toJson(candidate),
                    "aiadrika"
                );
                if (persisted) {
                    saved++;
                    notificationService.notifyInboundMessage("whatsapp", contact, text);
                    sendAutoReplySafely("whatsapp", contact);
                }
            }

            if (saved == 0) {
                log.info("WhatsApp webhook received, no inbound messages detected.");
            } else {
                log.info("WhatsApp webhook processed, inbound saved={}", saved);
            }

            return Map.of("ok", true, "saved", saved);
        } finally {
            if (tenantWasMissing) {
                TenantContext.clear();
            }
        }
    }

    private void sendSocialMessage(String channel, String recipient, String body) {
        if ("whatsapp".equals(channel)) {
            sendViaAiadrikaWhatsApp(recipient, body);
            return;
        }

        if ("facebook".equals(channel)) {
            sendViaFacebookMessenger(recipient, body);
            return;
        }

        if ("instagram".equals(channel)) {
            sendViaInstagramMessaging(recipient, body);
            return;
        }

        if (!integrationService.isConnected(channel)) {
            throw new IllegalStateException("Connect " + channel + " in Integrations page first.");
        }

        log.info("Simulated {} send to {} with text length {}", channel, recipient, body.length());
        tryPersistCommunication(
            channel.toUpperCase(Locale.ROOT),
            "OUT",
            recipient,
            body,
            "SENT",
            null,
            "",
            channel
        );
        notifyOutboundCommunication(channel, recipient, body);
    }

    private void sendViaAiadrikaWhatsApp(String recipient, String body) {
        String number = recipient == null ? "" : recipient.replaceAll("\\D", "");
        if (number.isBlank()) {
            throw new IllegalStateException("Invalid WhatsApp number.");
        }

        Map<String, String> config = integrationService.getConfig("whatsapp");
        String provider = trim(config.get("provider")).toLowerCase(Locale.ROOT);
        String aknexusToken = firstNonBlank(config.get("apiToken"), config.get("bearerToken"), defaultAknexusApiToken);
        if ("aknexus".equals(provider)
            || (!aknexusToken.isBlank() && !"aiadrika".equals(provider) && !"kriscelwa".equals(provider))) {
            sendViaAknexusWhatsApp(number, body, config, aknexusToken);
            return;
        }

        String apiKey = trim(config.get("apiKey"));
        String sessionId = trim(config.get("sessionId"));

        if (!apiKey.isBlank() && !sessionId.isBlank()) {
            sendViaKriscelWA(number, body, config, apiKey, sessionId);
            return;
        }

        String instanceId = trim(config.get("instanceId"));
        String accessToken = trim(config.get("accessToken"));
        String configuredApiUrl = trim(config.get("apiUrl"));

        if (instanceId.isBlank()) {
            instanceId = trim(defaultInstanceId);
        }
        if (accessToken.isBlank()) {
            accessToken = trim(defaultAccessToken);
        }

        if (instanceId.isBlank() || accessToken.isBlank()) {
            throw new IllegalStateException("WhatsApp instance ID or access token is missing in backend config.");
        }

        String providerApiUrl = configuredApiUrl.isBlank() ? trim(aiadrikaBaseUrl) : configuredApiUrl;
        if (providerApiUrl.isBlank()) {
            throw new IllegalStateException("WhatsApp API URL is missing. Set apiUrl in Integrations or AIADRIKA_BASE_URL in backend env.");
        }

        String url = UriComponentsBuilder.fromHttpUrl(providerApiUrl)
            .queryParam("number", number)
            .queryParam("type", "text")
            .queryParam("message", body)
            .queryParam("instance_id", instanceId)
            .queryParam("access_token", accessToken)
            .build(true)
            .toUriString();

        try {
            String response = restTemplate.getForObject(url, String.class);
            String externalId = null;
            if (response != null && !response.isBlank()) {
                Map<String, Object> data = objectMapper.readValue(response, MAP_TYPE);
                Object status = data.get("status");
                if (status != null && "error".equalsIgnoreCase(String.valueOf(status))) {
                    String apiMessage = String.valueOf(data.getOrDefault("message", "Unknown error"));
                    throw new IllegalStateException("Aiadrika error: " + apiMessage);
                }
                externalId = extractExternalId(objectMapper.valueToTree(data));
            }
            tryPersistCommunication("WHATSAPP", "OUT", number, body, "SENT", externalId, response, "aiadrika");
            notifyOutboundCommunication("whatsapp", number, body);
            log.info("WhatsApp sent via Aiadrika to {}", number);
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            log.error("Aiadrika send failed: {}", ex.getMessage());
            throw new IllegalStateException("Failed to send WhatsApp message via Aiadrika.");
        }
    }

    private void sendViaAknexusWhatsApp(String number, String body, Map<String, String> config, String apiToken) {
        if (trim(apiToken).isBlank()) {
            throw new IllegalStateException("AKNexus API token is missing.");
        }

        String baseUrl = firstNonBlank(config.get("apiUrl"), defaultAknexusApiUrl);
        if (baseUrl.isBlank()) {
            baseUrl = "https://app.aknexus.in/api/v2";
        }
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        if (!baseUrl.endsWith("/api/v2")) {
            baseUrl = baseUrl + "/api/v2";
        }

        String instanceId = resolveAknexusInstanceId(
            baseUrl,
            apiToken,
            firstNonBlank(config.get("instanceId"), defaultAknexusInstanceId),
            config.get("senderNumber")
        );
        if (instanceId.isBlank()) {
            throw new IllegalStateException("AKNexus WhatsApp instance ID is missing.");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(trim(apiToken));

        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("instance_id", instanceId);
        payload.put("to", number);
        payload.put("message", body);

        try {
            String jsonBody = objectMapper.writeValueAsString(payload);
            HttpEntity<String> entity = new HttpEntity<>(jsonBody, headers);
            ResponseEntity<String> responseEntity = restTemplate.exchange(
                baseUrl + "/whatsapp/send/text",
                HttpMethod.POST,
                entity,
                String.class
            );
            String response = responseEntity.getBody();
            String externalId = null;
            if (response != null && !response.isBlank()) {
                Map<String, Object> data = objectMapper.readValue(response, MAP_TYPE);
                Object status = data.get("status");
                if (status != null && "error".equalsIgnoreCase(String.valueOf(status))) {
                    String apiMessage = String.valueOf(data.getOrDefault("message", "Unknown error"));
                    throw new IllegalStateException("AKNexus error: " + apiMessage);
                }
                externalId = extractExternalId(objectMapper.valueToTree(data));
            }
            tryPersistCommunication("WHATSAPP", "OUT", number, body, "SENT", externalId, response, "aknexus");
            notifyOutboundCommunication("whatsapp", number, body);
            log.info("WhatsApp sent via AKNexus to {}", number);
        } catch (HttpStatusCodeException ex) {
            log.error("AKNexus WhatsApp API error {}: {}", ex.getStatusCode(), ex.getResponseBodyAsString());
            throw new IllegalStateException("AKNexus WhatsApp API error: " + ex.getResponseBodyAsString());
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            log.error("AKNexus WhatsApp send failed: {}", ex.getMessage());
            throw new IllegalStateException("Failed to send WhatsApp message via AKNexus.");
        }
    }

    private void sendViaAknexusWhatsAppDocument(
        String number,
        byte[] document,
        String fileName,
        String caption,
        String mediaUrl,
        Map<String, String> config,
        String apiToken
    ) {
        if (trim(apiToken).isBlank()) {
            throw new IllegalStateException("AKNexus API token is missing.");
        }
        if (document.length == 0) {
            throw new IllegalStateException("Pipeline PDF is empty.");
        }

        String baseUrl = firstNonBlank(config.get("apiUrl"), defaultAknexusApiUrl);
        if (baseUrl.isBlank()) baseUrl = "https://app.aknexus.in/api/v2";
        if (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        if (!baseUrl.endsWith("/api/v2")) baseUrl = baseUrl + "/api/v2";

        String instanceId = resolveAknexusInstanceId(
            baseUrl,
            apiToken,
            firstNonBlank(config.get("instanceId"), defaultAknexusInstanceId),
            config.get("senderNumber")
        );
        if (instanceId.isBlank()) {
            throw new IllegalStateException("AKNexus WhatsApp instance ID is missing.");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(trim(apiToken));
        if (mediaUrl == null || mediaUrl.isBlank()) {
            throw new IllegalStateException("AKNexus PDF media URL is missing.");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("instance_id", instanceId);
        payload.put("to", number);
        payload.put("filename", fileName);
        payload.put("caption", caption == null ? "" : caption);
        payload.put("media_url", mediaUrl);

        try {
            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(payload), headers);
            ResponseEntity<String> responseEntity = restTemplate.exchange(
                baseUrl + "/whatsapp/send/document",
                HttpMethod.POST,
                entity,
                String.class
            );
            String response = responseEntity.getBody();
            String externalId = null;
            if (response != null && !response.isBlank()) {
                Map<String, Object> data = objectMapper.readValue(response, MAP_TYPE);
                Object status = data.get("status");
                if (status != null && "error".equalsIgnoreCase(String.valueOf(status))) {
                    String apiMessage = String.valueOf(data.getOrDefault("message", "Unknown error"));
                    throw new IllegalStateException("AKNexus error: " + apiMessage);
                }
                externalId = extractExternalId(objectMapper.valueToTree(data));
            }
            String activity = (caption == null || caption.isBlank()) ? fileName : caption;
            tryPersistCommunication("WHATSAPP", "OUT", number, activity, "SENT", externalId, response, "aknexus");
            notifyOutboundCommunication("whatsapp", number, activity);
            log.info("WhatsApp PDF sent via AKNexus to {}", number);
        } catch (HttpStatusCodeException ex) {
            log.error("AKNexus WhatsApp document API error {}: {}", ex.getStatusCode(), ex.getResponseBodyAsString());
            throw new IllegalStateException("AKNexus WhatsApp PDF API error: " + ex.getResponseBodyAsString());
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            log.error("AKNexus WhatsApp document send failed: {}", ex.getMessage());
            throw new IllegalStateException("Failed to send WhatsApp PDF via AKNexus.");
        }
    }

    private String resolveAknexusInstanceId(String baseUrl, String apiToken, String configuredInstanceId, String senderNumber) {
        String desiredSender = senderNumber == null ? "" : senderNumber.replaceAll("\\D", "");
        if (desiredSender.isBlank()) {
            return trim(configuredInstanceId);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(trim(apiToken));

        try {
            ResponseEntity<String> responseEntity = restTemplate.exchange(
                baseUrl + "/whatsapp/instances",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class
            );
            String response = responseEntity.getBody();
            if (response == null || response.isBlank()) {
                throw new IllegalStateException("AKNexus returned an empty instance list.");
            }

            Map<String, Object> data = objectMapper.readValue(response, MAP_TYPE);
            Object instances = data.get("instances");
            if (instances instanceof List<?> list) {
                for (Object item : list) {
                    JsonNode row = objectMapper.valueToTree(item);
                    String phone = row.path("phone").asText("").replaceAll("\\D", "");
                    String instanceId = trim(row.path("instance_id").asText(""));
                    String status = trim(row.path("status").asText(""));
                    if (desiredSender.equals(phone) && !instanceId.isBlank()) {
                        if (!"connected".equalsIgnoreCase(status) && !"success".equalsIgnoreCase(status)) {
                            throw new IllegalStateException("AKNexus sender " + desiredSender + " is not connected.");
                        }
                        return instanceId;
                    }
                }
            }

            throw new IllegalStateException("AKNexus sender number " + desiredSender + " was not found.");
        } catch (HttpStatusCodeException ex) {
            log.error("AKNexus instance lookup failed {}: {}", ex.getStatusCode(), ex.getResponseBodyAsString());
            throw new IllegalStateException("Unable to verify AKNexus sender number: " + ex.getResponseBodyAsString());
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            log.error("AKNexus sender lookup failed: {}", ex.getMessage());
            throw new IllegalStateException("Unable to verify AKNexus sender number.");
        }
    }

    private void sendViaKriscelWA(String number, String body, Map<String, String> config, String apiKey, String sessionId) {
        String configuredApiUrl = trim(config.get("apiUrl"));
        String baseUrl = configuredApiUrl.isBlank() ? "https://kriscelwa.187.127.149.196.nip.io/api" : configuredApiUrl;
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }

        String url = baseUrl + "/sessions/" + sessionId + "/messages/send-text";
        String chatId = number + "@c.us";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-API-Key", apiKey);

        Map<String, String> payload = new HashMap<>();
        payload.put("chatId", chatId);
        payload.put("text", body);

        try {
            String jsonBody = objectMapper.writeValueAsString(payload);
            HttpEntity<String> entity = new HttpEntity<>(jsonBody, headers);
            ResponseEntity<String> responseEntity = restTemplate.exchange(url, HttpMethod.POST, entity, String.class);
            String response = responseEntity.getBody();
            String externalId = null;
            if (response != null && !response.isBlank()) {
                Map<String, Object> data = objectMapper.readValue(response, MAP_TYPE);
                externalId = extractExternalId(objectMapper.valueToTree(data));
            }
            tryPersistCommunication("WHATSAPP", "OUT", number, body, "SENT", externalId, response, "kriscelwa");
            notifyOutboundCommunication("whatsapp", number, body);
            log.info("WhatsApp sent via KriscelWA to {}", number);
        } catch (HttpStatusCodeException ex) {
            log.error("KriscelWA API error {}: {}", ex.getStatusCode(), ex.getResponseBodyAsString());
            throw new IllegalStateException("KriscelWA API error: " + ex.getResponseBodyAsString());
        } catch (Exception ex) {
            log.error("KriscelWA send failed: {}", ex.getMessage());
            throw new IllegalStateException("Failed to send WhatsApp message via KriscelWA.");
        }
    }

    private void sendViaFacebookMessenger(String recipient, String body) {
        String psid = recipient == null ? "" : recipient.replaceAll("\\D", "");
        if (psid.isBlank()) {
            throw new IllegalStateException("Invalid Facebook PSID.");
        }

        Map<String, String> config = integrationService.getConfig("facebook");
        String accessToken = trim(config.get("accessToken"));
        if (accessToken.isBlank()) {
            accessToken = trim(defaultFacebookPageAccessToken);
        }
        if (accessToken.isBlank()) {
            throw new IllegalStateException("Facebook Page access token is missing in Integrations or backend config.");
        }

        String pageId = trim(config.get("pageId"));
        String pageNode = pageId.isBlank() ? "me" : pageId;

        String url = buildFacebookMessagesUrl(accessToken, pageNode);
        String meUrl = buildFacebookMessagesUrl(accessToken, "me");

        Map<String, Object> responsePayload = Map.of(
            "recipient", Map.of("id", psid),
            "messaging_type", "RESPONSE",
            "message", Map.of("text", body)
        );

        try {
            log.info(
                "Facebook send attempt: pageNode={}, psid={}, endpoint={}",
                pageNode,
                psid,
                url
            );
            @SuppressWarnings("unchecked")
            Map<String, Object> response = restTemplate.postForObject(url, responsePayload, Map.class);
            persistFacebookSend(psid, body, response);
            log.info("Facebook message sent to PSID {}", psid);
        } catch (HttpStatusCodeException ex) {
            String apiBody = trim(ex.getResponseBodyAsString());
            log.error(
                "Facebook send failed: pageNode={}, psid={}, endpoint={}, status={}, body={}",
                pageNode,
                psid,
                url,
                ex.getStatusCode(),
                apiBody
            );

            if (shouldRetryFacebookSendWithMeEndpoint(apiBody, pageNode)) {
                try {
                    log.warn(
                        "Facebook send fallback triggered: original_pageNode={}, psid={}, fallback_endpoint={}",
                        pageNode,
                        psid,
                        meUrl
                    );
                    @SuppressWarnings("unchecked")
                    Map<String, Object> meResponse = restTemplate.postForObject(meUrl, responsePayload, Map.class);
                    persistFacebookSend(psid, body, meResponse);
                    log.info("Facebook message sent to PSID {} using /me/messages fallback", psid);
                    return;
                } catch (HttpStatusCodeException meEx) {
                    String meApiBody = trim(meEx.getResponseBodyAsString());
                    log.error(
                        "Facebook /me/messages fallback failed: original_pageNode={}, psid={}, fallback_endpoint={}, status={}, body={}",
                        pageNode,
                        psid,
                        meUrl,
                        meEx.getStatusCode(),
                        meApiBody
                    );
                }
            }

            if (isOutsideFacebookMessagingWindow(apiBody)) {
                if (retryFacebookOutOfWindowWithMessageTag) {
                    String tag = normalizeFacebookMessageTag(facebookMessageTag);
                    Map<String, Object> taggedPayload = Map.of(
                        "recipient", Map.of("id", psid),
                        "messaging_type", "MESSAGE_TAG",
                        "tag", tag,
                        "message", Map.of("text", body)
                    );
                    try {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> taggedResponse = restTemplate.postForObject(url, taggedPayload, Map.class);
                        persistFacebookSend(psid, body, taggedResponse);
                        log.info("Facebook message sent to PSID {} with MESSAGE_TAG {}", psid, tag);
                        return;
                    } catch (HttpStatusCodeException tagEx) {
                        String taggedApiBody = trim(tagEx.getResponseBodyAsString());
                        log.error(
                            "Facebook MESSAGE_TAG send failed: status={}, tag={}, body={}",
                            tagEx.getStatusCode(),
                            tag,
                            taggedApiBody
                        );
                        throw new IllegalStateException(
                            "Facebook rejected the message outside the 24-hour window. "
                                + "Retry with MESSAGE_TAG also failed. "
                                + "Use an allowed tag/use-case or wait for user re-engagement."
                        );
                    } catch (Exception tagEx) {
                        log.error("Facebook MESSAGE_TAG send failed: {}", tagEx.getMessage(), tagEx);
                        throw new IllegalStateException(
                            "Facebook rejected the message outside the 24-hour window and tag retry failed."
                        );
                    }
                }

                throw new IllegalStateException(
                    "Facebook Messenger 24-hour policy blocked this send. "
                        + "Ask the contact to message your Page first, or enable message-tag retry in backend config for valid non-promotional use cases."
                );
            }

            throw new IllegalStateException(
                apiBody.isBlank()
                    ? "Failed to send Facebook message."
                    : "Facebook send failed: " + apiBody
            );
        } catch (Exception ex) {
            log.error(
                "Facebook send failed with exception: pageNode={}, psid={}, endpoint={}, message={}",
                pageNode,
                psid,
                url,
                ex.getMessage(),
                ex
            );
            throw new IllegalStateException("Failed to send Facebook message.");
        }
    }

    private void persistFacebookSend(String psid, String body, Map<String, Object> response) {
        String externalId = "";
        if (response != null && response.get("message_id") != null) {
            externalId = String.valueOf(response.get("message_id"));
        }
        String rawPayload = response == null ? "" : toJson(objectMapper.valueToTree(response));
        String displayName = resolveFacebookProfileName(psid);
        tryPersistCommunication(
            "FACEBOOK",
            "OUT",
            psid,
            body,
            "SENT",
            externalId,
            rawPayload,
            "facebook_messenger",
            displayName
        );
        notifyOutboundCommunication("facebook", psid, body);
    }

    private boolean isOutsideFacebookMessagingWindow(String apiBody) {
        String normalized = trim(apiBody).toLowerCase(Locale.ROOT);
        return normalized.contains("outside the allowed window")
            || (normalized.contains("\"code\":10") && normalized.contains("messenger-platform/policy-overview"));
    }

    private boolean shouldRetryFacebookSendWithMeEndpoint(String apiBody, String pageNode) {
        if ("me".equalsIgnoreCase(trim(pageNode))) {
            return false;
        }
        String normalized = trim(apiBody).toLowerCase(Locale.ROOT);
        return normalized.contains("\"code\":1")
            || (normalized.contains("unsupported post request") && normalized.contains("object with id"));
    }

    private String buildFacebookMessagesUrl(String accessToken, String pageNode) {
        return UriComponentsBuilder
            .fromHttpUrl("https://graph.facebook.com/{version}/{pageNode}/messages")
            .queryParam("access_token", accessToken)
            .buildAndExpand(metaGraphApiVersion, pageNode)
            .toUriString();
    }

    private String normalizeFacebookMessageTag(String tag) {
        String normalized = trim(tag).toUpperCase(Locale.ROOT).replace('-', '_').replace(' ', '_');
        return normalized.isBlank() ? "HUMAN_AGENT" : normalized;
    }

    private void sendViaInstagramMessaging(String recipient, String body) {
        String igsid = trim(recipient);
        if (igsid.isBlank()) {
            throw new IllegalStateException("Invalid Instagram recipient ID.");
        }

        Map<String, String> instagramConfig = integrationService.getConfig("instagram");
        String igAccountId = trim(instagramConfig.get("igAccountId"));
        String accessToken = trim(instagramConfig.get("accessToken"));

        if (accessToken.isBlank()) {
            accessToken = trim(defaultFacebookPageAccessToken);
        }
        if (igAccountId.isBlank()) {
            throw new IllegalStateException("Instagram Account ID is missing in Integrations.");
        }
        if (accessToken.isBlank()) {
            throw new IllegalStateException("Instagram access token is missing in Integrations or backend config.");
        }

        String url = UriComponentsBuilder
            .fromHttpUrl("https://graph.facebook.com/{version}/{igAccountId}/messages")
            .queryParam("access_token", accessToken)
            .buildAndExpand(metaGraphApiVersion, igAccountId)
            .toUriString();

        Map<String, Object> payload = Map.of(
            "recipient", Map.of("id", igsid),
            "messaging_type", "RESPONSE",
            "message", Map.of("text", body)
        );

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> response = restTemplate.postForObject(url, payload, Map.class);
            String externalId = "";
            if (response != null && response.get("message_id") != null) {
                externalId = String.valueOf(response.get("message_id"));
            }
            String rawPayload = response == null ? "" : toJson(objectMapper.valueToTree(response));
            String displayName = instagramNameCache.getOrDefault(igsid, "");
            tryPersistCommunication(
                "INSTAGRAM",
                "OUT",
                igsid,
                body,
                "SENT",
                externalId,
                rawPayload,
                "instagram_messaging",
                displayName
            );
            notifyOutboundCommunication("instagram", igsid, body);
            log.info("Instagram message sent to IGSID {}", igsid);
        } catch (HttpStatusCodeException ex) {
            String apiBody = trim(ex.getResponseBodyAsString());
            log.error("Instagram send failed: status={}, body={}", ex.getStatusCode(), apiBody);
            throw new IllegalStateException(
                apiBody.isBlank()
                    ? "Failed to send Instagram message."
                    : "Instagram send failed: " + apiBody
            );
        } catch (Exception ex) {
            log.error("Instagram send failed: {}", ex.getMessage(), ex);
            throw new IllegalStateException("Failed to send Instagram message.");
        }
    }

    private void sendVoiceCall(
        VoiceAgentConfig config,
        String recipient,
        String script,
        String triggerSource,
        Map<String, Object> metadata
    ) {
        if (!config.enabled()) {
            throw new IllegalStateException("Voice call agent is disabled.");
        }
        String targetPhone = firstNonBlank(metadataValue(metadata, "toNumber"), recipient);
        String normalizedPhone = normalizePhoneForCall(targetPhone);
        if (normalizedPhone.isBlank()) {
            throw new IllegalStateException("Invalid phone number for voice call.");
        }

        String callScript = trim(script);
        if (callScript.isBlank()) {
            callScript = "Hello, this is NexaCRM. We are calling to follow up on your enquiry.";
        }

        String leadId = extractLeadId(metadata);
        String leadName = extractLeadName(metadata);

        String requestedSetup = firstNonBlank(metadataValue(metadata, "setup"), metadataValue(metadata, "provider"));
        String provider = requestedSetup.isBlank() ? trim(config.provider()).toLowerCase(Locale.ROOT) : requestedSetup.toLowerCase(Locale.ROOT);
        String overrideFromNumber = firstNonBlank(metadataValue(metadata, "fromNumber"), metadataValue(metadata, "from"));

        if ("webhook".equals(provider)) {
            queueWebhookCall(config, normalizedPhone, callScript, triggerSource, metadata, leadId, leadName, overrideFromNumber);
            return;
        }
        if ("twilio".equals(provider)) {
            queueTwilioDirectCall(config, normalizedPhone, callScript, triggerSource, metadata, leadId, leadName, overrideFromNumber);
            return;
        }

        boolean forceTwilio = "bolna_twilio".equals(provider) || "twilio".equalsIgnoreCase(config.telephonyProvider());
        queueBolnaCall(config, normalizedPhone, callScript, triggerSource, metadata, leadId, leadName, overrideFromNumber, forceTwilio);
    }

    private void queueWebhookCall(
        VoiceAgentConfig config,
        String normalizedPhone,
        String callScript,
        String triggerSource,
        Map<String, Object> metadata,
        String leadId,
        String leadName
    ) {
        queueWebhookCall(config, normalizedPhone, callScript, triggerSource, metadata, leadId, leadName, null);
    }

    private void queueWebhookCall(
        VoiceAgentConfig config,
        String normalizedPhone,
        String callScript,
        String triggerSource,
        Map<String, Object> metadata,
        String leadId,
        String leadName,
        String overrideFromNumber
    ) {
        if (config.webhookUrl().isBlank()) {
            throw new IllegalStateException("Voice call webhook URL is missing.");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (!config.apiKey().isBlank()) {
            headers.setBearerAuth(config.apiKey());
        }

        String callerNum = firstNonBlank(overrideFromNumber, config.fromNumber());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("to", normalizedPhone);
        payload.put("script", callScript);
        payload.put("triggerSource", trim(triggerSource));
        payload.put("provider", "nexacrm_voice_call_agent");
        payload.put("timeoutMs", Math.max(3000, callAgentTimeoutMs));
        if (!callerNum.isBlank()) {
            payload.put("from", callerNum);
        }
        if (!config.agentId().isBlank()) {
            payload.put("agentId", config.agentId());
        }
        if (metadata != null && !metadata.isEmpty()) {
            payload.put("metadata", metadata);
        }

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                config.webhookUrl(),
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                String.class
            );

            String responseBody = trim(response.getBody());
            String externalId = extractExternalIdFromRawResponse(responseBody);
            String status = response.getStatusCode().is2xxSuccessful() ? "QUEUED" : "FAILED";
            boolean persisted = tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedPhone,
                callScript,
                status,
                externalId,
                responseBody,
                "voice_call_agent",
                leadName,
                leadId
            );
            if (!persisted) {
                log.warn("Could not persist CALL communication for {}", normalizedPhone);
            }

            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new IllegalStateException("Voice call provider returned status " + response.getStatusCode().value());
            }
        } catch (HttpStatusCodeException ex) {
            String apiBody = trim(ex.getResponseBodyAsString());
            tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedPhone,
                callScript,
                "FAILED",
                "",
                apiBody,
                "voice_call_agent",
                leadName,
                leadId
            );
            throw new IllegalStateException(
                apiBody.isBlank()
                    ? "Failed to queue voice call."
                    : "Voice call provider error: " + apiBody
            );
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to queue voice call.");
        }
    }

    private void queueBolnaCall(
        VoiceAgentConfig config,
        String normalizedPhone,
        String callScript,
        String triggerSource,
        Map<String, Object> metadata,
        String leadId,
        String leadName
    ) {
        queueBolnaCall(config, normalizedPhone, callScript, triggerSource, metadata, leadId, leadName, null, false);
    }

    private void queueBolnaCall(
        VoiceAgentConfig config,
        String normalizedPhone,
        String callScript,
        String triggerSource,
        Map<String, Object> metadata,
        String leadId,
        String leadName,
        String overrideFromNumber,
        boolean forceTwilio
    ) {
        String bolnaCallApiUrl = resolveBolnaCallApiUrl(config.bolnaApiUrl());
        String bolnaApiKey = firstNonBlank(config.bolnaApiKey(), config.apiKey());
        String bolnaAgentId = firstNonBlank(config.bolnaAgentId(), config.agentId());

        if (bolnaApiKey.isBlank()) {
            throw new IllegalStateException("Bolna API key is missing.");
        }
        if (bolnaAgentId.isBlank()) {
            throw new IllegalStateException("Bolna agent ID is missing.");
        }

        String callerNumber = firstNonBlank(overrideFromNumber, config.twilioFromNumber(), config.fromNumber());

        Map<String, Object> userData = new LinkedHashMap<>();
        if (!trim(leadId).isBlank()) {
            userData.put("lead_id", trim(leadId));
        }
        if (!trim(leadName).isBlank()) {
            userData.put("lead_name", trim(leadName));
        }
        userData.put("trigger_source", trim(triggerSource));
        userData.put("call_script", callScript);
        if (!callerNumber.isBlank()) {
            userData.put("caller_phone_number", callerNumber);
            userData.put("from_number", callerNumber);
        }
        putIfPresent(userData, "lead_company", metadataValue(metadata, "company"));
        putIfPresent(userData, "service_interest", metadataValue(metadata, "service"));
        putIfPresent(userData, "lead_source", firstNonBlank(
            metadataValue(metadata, "source"),
            metadataValue(metadata, "leadSource")
        ));
        putIfPresent(userData, "assigned_to", metadataValue(metadata, "assignedTo"));
        userData.put("agent_instructions", buildAgentInstructions(leadName, metadata));
        String callbackWebhookUrl = resolveCallAgentWebhookUrl(config);
        if (!callbackWebhookUrl.isBlank()) {
            userData.put("callback_webhook_url", callbackWebhookUrl);
        }
        if (!config.webhookSecret().isBlank()) {
            userData.put("callback_webhook_secret", config.webhookSecret());
        }
        if (metadata != null && !metadata.isEmpty()) {
            userData.put("metadata", metadata);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("agent_id", bolnaAgentId);
        payload.put("recipient_phone_number", normalizedPhone);
        if (!callerNumber.isBlank()) {
            payload.put("from_phone_number", callerNumber);
        }
        if (!userData.isEmpty()) {
            payload.put("user_data", userData);
        }

        boolean useTwilio = forceTwilio || !config.twilioAccountSid().isBlank();
        if (useTwilio) {
            payload.put("telephony_provider", "twilio");
            if (!config.twilioAccountSid().isBlank()) {
                payload.put("telephony_account_sid", config.twilioAccountSid());
                payload.put("twilio_account_sid", config.twilioAccountSid());
            }
            if (!config.twilioAuthToken().isBlank()) {
                payload.put("telephony_auth_token", config.twilioAuthToken());
                payload.put("twilio_auth_token", config.twilioAuthToken());
            }
            Map<String, Object> telephonyConfig = new LinkedHashMap<>();
            telephonyConfig.put("provider", "twilio");
            if (!callerNumber.isBlank()) telephonyConfig.put("phone_number", callerNumber);
            if (!config.twilioAccountSid().isBlank()) telephonyConfig.put("account_sid", config.twilioAccountSid());
            if (!config.twilioAuthToken().isBlank()) telephonyConfig.put("auth_token", config.twilioAuthToken());
            payload.put("telephony_config", telephonyConfig);
        }

        String voiceId = trim(config.bolnaVoiceId());
        if (!voiceId.isBlank()) {
            payload.put("agent_data", Map.of("voice_id", voiceId));
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(bolnaApiKey);

        String providerName = useTwilio ? "bolna_twilio" : "bolna";

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                bolnaCallApiUrl,
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                String.class
            );

            String responseBody = trim(response.getBody());
            String externalId = extractExternalIdFromRawResponse(responseBody);
            if (externalId.isBlank()) {
                externalId = extractExternalIdFromMap(readJsonMap(responseBody));
            }

            Map<String, Object> raw = new LinkedHashMap<>();
            raw.put("provider", providerName);
            raw.put("request", payload);
            raw.put("response", readJsonObject(responseBody));

            boolean persisted = tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedPhone,
                callScript,
                response.getStatusCode().is2xxSuccessful() ? "QUEUED" : "FAILED",
                externalId,
                toJsonSafe(raw),
                providerName,
                leadName,
                leadId
            );
            if (!persisted) {
                log.warn("Could not persist {} CALL communication for {}", providerName, normalizedPhone);
            }

            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new IllegalStateException("Bolna call API returned status " + response.getStatusCode().value());
            }
        } catch (HttpStatusCodeException ex) {
            String apiBody = trim(ex.getResponseBodyAsString());
            tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedPhone,
                callScript,
                "FAILED",
                "",
                apiBody,
                providerName,
                leadName,
                leadId
            );
            throw new IllegalStateException(
                apiBody.isBlank()
                    ? "Failed to queue Bolna call."
                    : "Bolna error: " + apiBody
            );
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to queue Bolna call: " + ex.getMessage());
        }
    }

    private void queueTwilioDirectCall(
        VoiceAgentConfig config,
        String normalizedPhone,
        String callScript,
        String triggerSource,
        Map<String, Object> metadata,
        String leadId,
        String leadName,
        String overrideFromNumber
    ) {
        String accountSid = config.twilioAccountSid();
        String authToken = config.twilioAuthToken();
        String fromNumber = firstNonBlank(overrideFromNumber, config.twilioFromNumber(), config.fromNumber());

        if (accountSid.isBlank() || authToken.isBlank()) {
            throw new IllegalStateException("Twilio Account SID and Auth Token are required for direct Twilio calls.");
        }
        if (fromNumber.isBlank()) {
            throw new IllegalStateException("Twilio caller phone number (From) is required.");
        }

        String twilioUrl = "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Calls.json";

        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(accountSid, authToken);
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        String twiml = "<Response><Say voice=\"alice\">" + escapeXml(callScript) + "</Say></Response>";

        org.springframework.util.MultiValueMap<String, String> form = new org.springframework.util.LinkedMultiValueMap<>();
        form.add("To", normalizedPhone);
        form.add("From", fromNumber);
        form.add("Twiml", twiml);
        String callbackWebhookUrl = resolveCallAgentWebhookUrl(config);
        if (!callbackWebhookUrl.isBlank()) {
            form.add("StatusCallback", callbackWebhookUrl);
            form.add("StatusCallbackMethod", "POST");
        }

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                twilioUrl,
                HttpMethod.POST,
                new HttpEntity<>(form, headers),
                Map.class
            );

            Map<?, ?> body = response.getBody() == null ? Map.of() : response.getBody();
            String externalId = trim(String.valueOf(body.get("sid")));
            String status = trim(String.valueOf(body.get("status"))).toUpperCase(Locale.ROOT);
            if (status.isBlank()) status = "QUEUED";

            Map<String, Object> raw = new LinkedHashMap<>();
            raw.put("provider", "twilio");
            raw.put("from", fromNumber);
            raw.put("to", normalizedPhone);
            raw.put("response", body);

            boolean persisted = tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedPhone,
                callScript,
                status,
                externalId,
                toJsonSafe(raw),
                "twilio",
                leadName,
                leadId
            );
            if (!persisted) {
                log.warn("Could not persist Twilio CALL communication for {}", normalizedPhone);
            }
        } catch (HttpStatusCodeException ex) {
            String apiBody = trim(ex.getResponseBodyAsString());
            tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedPhone,
                callScript,
                "FAILED",
                "",
                apiBody,
                "twilio",
                leadName,
                leadId
            );
            throw new IllegalStateException(apiBody.isBlank() ? "Failed to place Twilio call." : "Twilio error: " + apiBody);
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to place Twilio call: " + ex.getMessage());
        }
    }

    private String escapeXml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\"", "&quot;")
                   .replace("'", "&apos;");
    }

    private Map<String, Object> readJsonMap(String value) {
        if (trim(value).isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(value, MAP_TYPE);
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private String resolveCallAgentWebhookUrl(VoiceAgentConfig config) {
        String candidate = firstNonBlank(
            config.callbackWebhookUrl(),
            config.webhookUrl()
        );
        if (!candidate.isBlank()) {
            return candidate;
        }
        return "";
    }

    private String resolveBolnaCallApiUrl(String value) {
        String normalized = trim(value);
        if (normalized.isBlank()) {
            normalized = "https://api.bolna.ai";
        } else if (!normalized.startsWith("https://") && !normalized.startsWith("http://")) {
            normalized = "https://" + normalized;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.endsWith("/call")) {
            return normalized;
        }
        return normalized + "/call";
    }

    private Map<String, Object> fetchBolnaExecutionDetails(String executionId) {
        String normalizedExecutionId = trim(executionId);
        if (normalizedExecutionId.isBlank()) {
            return Map.of();
        }

        VoiceAgentConfig config = resolveVoiceAgentConfig();
        String apiKey = firstNonBlank(config.bolnaApiKey(), config.apiKey());
        if (apiKey.isBlank()) {
            return Map.of();
        }

        String apiUrl = normalizeBolnaApiBaseUrl(config.bolnaApiUrl());
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey);
            headers.setAccept(List.of(MediaType.APPLICATION_JSON));

            for (String path : List.of("/executions/", "/execution/", "/call/", "/v2/execution/", "/v2/call/")) {
                try {
                    ResponseEntity<String> response = restTemplate.exchange(
                        apiUrl + path + normalizedExecutionId,
                        HttpMethod.GET,
                        new HttpEntity<>(headers),
                        String.class
                    );
                    Object root = readJsonObject(response.getBody());
                    if (root instanceof Map<?, ?> map) {
                        Map<String, Object> result = new LinkedHashMap<>();
                        map.forEach((key, value) -> result.put(String.valueOf(key), value));
                        return result;
                    }
                } catch (Exception ignored) {
                    // try the next supported Bolna execution path
                }
            }
        } catch (Exception ex) {
            log.debug("Failed to fetch Bolna execution {}: {}", normalizedExecutionId, ex.getMessage());
        }
        return Map.of();
    }

    private void stopBolnaExecution(String executionId) {
        String normalizedExecutionId = trim(executionId);
        if (normalizedExecutionId.isBlank()) {
            return;
        }

        VoiceAgentConfig config = resolveVoiceAgentConfig();
        String apiKey = firstNonBlank(config.bolnaApiKey(), config.apiKey());
        if (apiKey.isBlank()) {
            log.warn("Cannot stop Bolna call {} because API key is missing", normalizedExecutionId);
            return;
        }

        String apiUrl = normalizeBolnaApiBaseUrl(config.bolnaApiUrl());
        String stopUrl = UriComponentsBuilder
            .fromHttpUrl(apiUrl)
            .pathSegment("call", normalizedExecutionId, "stop")
            .toUriString();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(apiKey);
            headers.setAccept(List.of(MediaType.APPLICATION_JSON));
            restTemplate.exchange(
                stopUrl,
                HttpMethod.POST,
                new HttpEntity<>(headers),
                String.class
            );
            log.info("Requested Bolna stop for execution {}", normalizedExecutionId);
        } catch (HttpStatusCodeException ex) {
            log.warn("Bolna stop failed for execution {}: {}", normalizedExecutionId, trim(ex.getResponseBodyAsString()));
        } catch (Exception ex) {
            log.warn("Bolna stop failed for execution {}: {}", normalizedExecutionId, ex.getMessage());
        }
    }

    private String normalizeBolnaApiBaseUrl(String value) {
        String normalized = trim(value);
        if (normalized.isBlank()) {
            normalized = "https://api.bolna.ai";
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private String findFirstTextByKeys(Object source, List<String> keys) {
        if (source == null || keys == null || keys.isEmpty()) {
            return "";
        }
        if (source instanceof Map<?, ?> map) {
            for (String key : keys) {
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    if (key.equalsIgnoreCase(String.valueOf(entry.getKey()))) {
                        String value = asText(entry.getValue());
                        if (!value.isBlank()) {
                            return value;
                        }
                    }
                }
            }
            for (Object value : map.values()) {
                if (value instanceof Map<?, ?> || value instanceof List<?>) {
                    String nested = findFirstTextByKeys(value, keys);
                    if (!nested.isBlank()) {
                        return nested;
                    }
                }
            }
        } else if (source instanceof List<?> list) {
            for (Object item : list) {
                String nested = findFirstTextByKeys(item, keys);
                if (!nested.isBlank()) {
                    return nested;
                }
            }
        }
        return "";
    }

    private String extractTranscriptFromNode(Object source) {
        if (source == null) {
            return "";
        }
        if (source instanceof Map<?, ?> map) {
            String direct = firstNonBlank(
                scalarText(map.get("transcript")),
                scalarText(map.get("final_transcript")),
                scalarText(map.get("full_transcript")),
                scalarText(map.get("conversation_transcript")),
                scalarText(map.get("transcriptText")),
                scalarText(map.get("transcript_text"))
            );
            if (!direct.isBlank()) {
                return direct;
            }

            String rows = firstNonBlank(
                mergeTranscriptRows(map.get("transcripts")),
                mergeTranscriptRows(map.get("conversation")),
                mergeTranscriptRows(map.get("messages"))
            );
            if (!rows.isBlank()) {
                return rows;
            }

            for (Object value : map.values()) {
                if (value instanceof Map<?, ?> || value instanceof List<?>) {
                    String nested = extractTranscriptFromNode(value);
                    if (!nested.isBlank()) {
                        return nested;
                    }
                }
            }
        } else if (source instanceof List<?> list) {
            String merged = mergeTranscriptRows(list);
            if (!merged.isBlank()) {
                return merged;
            }
            for (Object item : list) {
                String nested = extractTranscriptFromNode(item);
                if (!nested.isBlank()) {
                    return nested;
                }
            }
        }
        return "";
    }

    private String mergeTranscriptRows(Object rows) {
        if (!(rows instanceof List<?> list) || list.isEmpty()) {
            return "";
        }
        List<String> lines = new ArrayList<>();
        for (Object row : list) {
            if (row instanceof String text) {
                String clean = trim(text);
                if (!clean.isBlank()) lines.add(clean);
                continue;
            }
            if (row instanceof Map<?, ?> map) {
                String text = firstNonBlank(
                    scalarText(map.get("text")),
                    scalarText(map.get("content")),
                    scalarText(map.get("message")),
                    scalarText(map.get("utterance")),
                    scalarText(map.get("reply")),
                    scalarText(map.get("transcript"))
                );
                if (text.isBlank()) {
                    continue;
                }
                String speaker = firstNonBlank(
                    scalarText(map.get("speaker")),
                    scalarText(map.get("role")),
                    scalarText(map.get("sender"))
                );
                lines.add(speaker.isBlank() ? text : speaker + ": " + text);
            }
        }
        return String.join("\n", lines).trim();
    }

    private String scalarText(Object value) {
        if (value instanceof String text) return trim(text);
        if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
        return "";
    }

    private boolean isQueuedLike(String status) {
        String normalized = normalizeCallStatus(status);
        return normalized.isBlank()
            || normalized.contains("QUEUED")
            || normalized.contains("SCHEDULED")
            || normalized.contains("CALLING")
            || normalized.contains("IN_PROGRESS")
            || normalized.contains("RINGING")
            || normalized.contains("INITIATED");
    }

    private String normalizeCallStatus(String status) {
        return trim(status).toUpperCase(Locale.ROOT).replace(' ', '_').replace('-', '_');
    }

    private Integer firstInteger(String value) {
        String normalized = trim(value);
        if (normalized.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(normalized);
        } catch (NumberFormatException ignored) {
            try {
                return (int) Math.round(Double.parseDouble(normalized));
            } catch (NumberFormatException ignoredAgain) {
                return null;
            }
        }
    }

    private <T> T firstNonNull(T first, T second) {
        return first != null ? first : second;
    }

    private String toJsonSafe(Object value) {
        if (value == null) {
            return "";
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ignored) {
            return "";
        }
    }

    private Object readJsonObject(String value) {
        try {
            if (trim(value).isBlank()) {
                return Map.of();
            }
            return objectMapper.readValue(value, Object.class);
        } catch (Exception ignored) {
            return trim(value);
        }
    }

    public VoiceAgentConfig resolveVoiceAgentConfig() {
        Map<String, String> config = integrationService.getConfig("voice_call_agent");
        Map<String, String> twilioConfig = integrationService.getConfig("twilio");

        String twilioAccountSid = firstNonBlank(config.get("twilioAccountSid"), config.get("accountSid"), twilioConfig.get("accountSid"), defaultTwilioAccountSid);
        String twilioAuthToken = firstNonBlank(config.get("twilioAuthToken"), config.get("authToken"), twilioConfig.get("authToken"), defaultTwilioAuthToken);
        String twilioFromNumber = firstNonBlank(config.get("twilioFromNumber"), twilioConfig.get("defaultFromNumber"), twilioConfig.get("fromNumber"), defaultTwilioDefaultFromNumber);
        String twilioPhoneNumbers = firstNonBlank(config.get("twilioPhoneNumbers"), twilioConfig.get("phoneNumbers"), defaultTwilioPhoneNumbers);
        String telephonyProvider = firstNonBlank(config.get("telephonyProvider"), "twilio");

        String provider = firstNonBlank(config.get("provider"), defaultCallAgentProvider, "bolna").toLowerCase(Locale.ROOT);
        boolean enabled = parseBooleanFlag(firstNonBlank(config.get("enabled"), String.valueOf(defaultCallAgentEnabled)));
        boolean autoCallOnLeadCreate = parseBooleanFlag(
            firstNonBlank(config.get("autoCallOnLeadCreate"), String.valueOf(defaultAutoCallOnLeadCreate))
        );
        String webhookUrl = firstNonBlank(config.get("webhookUrl"), defaultCallAgentWebhookUrl);
        String apiKey = firstNonBlank(config.get("apiKey"), defaultCallAgentApiKey);
        String agentId = firstNonBlank(config.get("agentId"), defaultCallAgentAgentId);
        String fromNumber = firstNonBlank(config.get("fromNumber"), twilioFromNumber, defaultCallAgentFromNumber);
        if (twilioFromNumber.isBlank()) {
            twilioFromNumber = fromNumber;
        }
        String webhookSecret = trim(config.get("webhookSecret"));
        String callbackWebhookUrl = firstNonBlank(config.get("callbackWebhookUrl"), defaultCallAgentCallbackWebhookUrl);
        String bolnaApiUrl = firstNonBlank(config.get("bolnaApiUrl"), defaultBolnaApiUrl);
        String bolnaApiKey = firstNonBlank(config.get("bolnaApiKey"), defaultBolnaApiKey);
        String bolnaAgentId = firstNonBlank(config.get("bolnaAgentId"), defaultBolnaAgentId);
        String bolnaVoiceId = firstNonBlank(config.get("bolnaVoiceId"), defaultBolnaVoiceId);
        return new VoiceAgentConfig(
            enabled,
            autoCallOnLeadCreate,
            provider,
            webhookUrl,
            apiKey,
            agentId,
            fromNumber,
            webhookSecret,
            callbackWebhookUrl,
            bolnaApiUrl,
            bolnaApiKey,
            bolnaAgentId,
            bolnaVoiceId,
            twilioAccountSid,
            twilioAuthToken,
            twilioFromNumber,
            twilioPhoneNumbers,
            telephonyProvider
        );
    }

    public Map<String, Object> getCallOptions() {
        VoiceAgentConfig config = resolveVoiceAgentConfig();
        Set<String> numbers = new LinkedHashSet<>();

        if (!config.twilioPhoneNumbers().isBlank()) {
            for (String s : config.twilioPhoneNumbers().split("[,;\\s]+")) {
                String clean = trim(s);
                if (!clean.isBlank()) numbers.add(clean);
            }
        }
        if (!config.twilioFromNumber().isBlank()) {
            numbers.add(trim(config.twilioFromNumber()));
        }
        if (!config.fromNumber().isBlank()) {
            numbers.add(trim(config.fromNumber()));
        }

        List<Map<String, Object>> setups = new ArrayList<>();
        setups.add(Map.of(
            "id", "bolna_twilio",
            "name", "Bolna AI + Twilio",
            "badge", "Recommended",
            "description", "Conversational AI voice agent (Bolna) connected with Twilio telephony line"
        ));
        setups.add(Map.of(
            "id", "bolna",
            "name", "Bolna AI (Default)",
            "badge", "Standard",
            "description", "Conversational AI voice agent using Bolna built-in telephony"
        ));
        setups.add(Map.of(
            "id", "twilio",
            "name", "Twilio Direct Voice",
            "badge", "Direct",
            "description", "Direct automated voice call through Twilio line"
        ));
        setups.add(Map.of(
            "id", "webhook",
            "name", "Custom Webhook",
            "badge", "Webhook",
            "description", "Dispatch outbound call event to external webhook"
        ));

        String active = trim(config.provider()).toLowerCase(Locale.ROOT);
        if (active.isBlank() || "bolna".equals(active)) {
            if (!config.twilioAccountSid().isBlank()) {
                active = "bolna_twilio";
            } else {
                active = "bolna";
            }
        }

        String defaultNumber = !config.twilioFromNumber().isBlank()
            ? config.twilioFromNumber()
            : (!config.fromNumber().isBlank() ? config.fromNumber() : (numbers.isEmpty() ? "" : numbers.iterator().next()));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("activeSetup", active);
        result.put("availableSetups", setups);
        result.put("phoneNumbers", new ArrayList<>(numbers));
        result.put("defaultPhoneNumber", defaultNumber);
        result.put("twilioConfigured", !config.twilioAccountSid().isBlank());
        result.put("bolnaConfigured", !config.bolnaApiKey().isBlank());
        result.put("enabled", config.enabled());
        return result;
    }

    private String buildLeadCallScript(String leadName, String company, String service) {
        Map<String, String> providerConfig = integrationService.getConfig("voice_call_agent");
        String template = trim(providerConfig.get("scriptTemplate"));
        if (template.isBlank()) {
            template = "Hello, kya main {leadName} ji se baat kar rahi hoon? Main Kriscel Tech se bol rahi hoon. "
                + "Aapne recently hamari website par inquiry submit ki thi{serviceSnippet}, usi regarding connect kar rahi hoon. "
                + "Kya abhi 2 minute baat karna convenient rahega?";
        }

        String safeLeadName = trim(leadName).isBlank() ? "Sir/Ma'am" : trim(leadName);
        String safeAgentName = trim(providerConfig.get("agentName")).isBlank() ? "Kriscel Tech" : trim(providerConfig.get("agentName"));
        String safeService = trim(service);
        String safeCompany = trim(company);
        String serviceSnippet = safeService.isBlank() ? "" : " for " + safeService;

        return template
            .replace("{leadName}", safeLeadName)
            .replace("{agentName}", safeAgentName)
            .replace("{company}", safeCompany)
            .replace("{service}", safeService)
            .replace("{serviceSnippet}", serviceSnippet);
    }

    private String buildAgentInstructions(String leadName, Map<String, Object> metadata) {
        String name = trim(leadName).isBlank() ? "Sir/Ma'am" : trim(leadName);
        String company = metadataValue(metadata, "company");
        String service = metadataValue(metadata, "service");
        String source = firstNonBlank(
            metadataValue(metadata, "source"),
            metadataValue(metadata, "leadSource")
        );

        String sourceContext = "website";
        if (!source.isBlank()) {
            String s = source.toLowerCase(Locale.ROOT);
            if (s.contains("facebook") || s.contains("meta")) sourceContext = "Facebook/Instagram";
            else if (s.contains("instagram")) sourceContext = "Instagram";
            else if (s.contains("linkedin")) sourceContext = "LinkedIn";
            else if (s.contains("whatsapp")) sourceContext = "WhatsApp";
            else if (s.contains("google")) sourceContext = "Google Ads";
        }

        return """
            IDENTITY: You are a polite, professional, friendly female sales caller for Kriscel Tech. \
            Speak naturally in Hinglish (Hindi-English mix), adapting to the caller's preferred language. \
            Always use female Hindi verb forms (rahi hoon, chahti hoon, karungi, leti hoon, deti hoon). \
            Tone: warm, consultative, never pushy. Keep calls 2-4 minutes.

            LEAD CONTEXT:
            - Name: %s
            - Company: %s
            - Service Interest: %s
            - Inquiry Source: %s

            CRM DATA RULES:
            - Use the lead name, company, service interest, and inquiry source from LEAD CONTEXT as already-known CRM data.
            - Do not ask the lead to repeat their name, company, service interest, or source when those values are available.
            - If a known value is useful, mention it naturally instead of asking for it.
            - Ask only for missing details or deeper requirement information that is not already present in CRM.

            CALL FLOW:
            1. INTRO: Confirm you are speaking with %s and mention the known inquiry context. Ask permission for 2 minutes.
            2. RAPPORT: "Main aapki requirement thoda better samajhna chahti hoon, taaki hum exactly wahi solution suggest kar sakein."
            3. DISCOVERY: Use known CRM details first, then ask only for missing/deeper details such as current requirement, biggest challenge, expected timeline, and preferred callback/demo time.
            4. TIMELINE SCORING: Based on their expected close timeline:
               - 1-3 days = HOT lead (ready now)
               - 7-10 days = WARM lead (interested but not urgent)
               - 10-15+ days or later = COLD lead (needs nurturing)
            5. SOFT CLOSE: Offer a short demo/discussion with expert team. Suggest today evening or tomorrow morning.
            6. PRICE OBJECTION: Never quote pricing. Say "Pricing aapki exact requirement par depend karti hai, pehle requirement samajhte hain."
            7. CLOSURE: Note details, confirm callback time, thank them warmly.
            8. CLOSING PREFERENCE: If the lead is not interested, end politely and capture the reason without changing lead calling eligibility.

            DATA TO CAPTURE: business_type, requirement, challenge, timeline, demo_scheduled, preferred_channel, call_outcome (HOT/WARM/COLD/NO_ANSWER/BUSY/FAILED), summary.

            GUARDRAILS: Never argue. Never invent info. Never quote pricing. Always confirm before finalizing. End politely if the lead is not interested.
            """.formatted(
                name,
                company,
                service,
                sourceContext,
                name
            );
    }

    private void putIfPresent(Map<String, Object> target, String key, String value) {
        String normalized = trim(value);
        if (!normalized.isBlank()) {
            target.put(key, normalized);
        }
    }

    private String metadataValue(Map<String, Object> metadata, String key) {
        if (metadata == null || key == null || !metadata.containsKey(key)) {
            return "";
        }
        Object value = metadata.get(key);
        return value == null ? "" : trim(String.valueOf(value));
    }

    private String extractExternalIdFromRawResponse(String responseBody) {
        if (trim(responseBody).isBlank()) {
            return "";
        }
        try {
            String fromJsonNode = extractExternalId(objectMapper.readTree(responseBody));
            if (!fromJsonNode.isBlank()) {
                return fromJsonNode;
            }
            return extractExternalIdFromMap(readJsonMap(responseBody));
        } catch (Exception ex) {
            return "";
        }
    }

    private String extractExternalIdFromMap(Map<String, Object> payload) {
        if (payload == null || payload.isEmpty()) {
            return "";
        }
        return firstNonBlank(
            asText(payload.get("execution_id")),
            asText(payload.get("executionId")),
            asText(payload.get("call_id")),
            asText(payload.get("callId")),
            asText(payload.get("externalId")),
            asText(payload.get("id"))
        );
    }

    private String normalizePhoneForCall(String raw) {
        String value = trim(raw);
        if (value.isBlank()) {
            return "";
        }
        boolean hasPlus = value.startsWith("+");
        String digits = value.replaceAll("\\D", "");
        if (digits.isBlank()) {
            return "";
        }
        if (hasPlus) {
            return "+" + digits;
        }
        if (digits.length() == 10) {
            return "+91" + digits;
        }
        if (digits.startsWith("91") && digits.length() == 12) {
            return "+" + digits;
        }
        return "+" + digits;
    }

    private String extractLeadId(Map<String, Object> metadata) {
        if (metadata == null || metadata.isEmpty()) {
            return "";
        }
        Object value = metadata.get("leadId");
        if (value == null) {
            value = metadata.get("lead_id");
        }
        return trim(value == null ? "" : String.valueOf(value));
    }

    private String extractLeadName(Map<String, Object> metadata) {
        if (metadata == null || metadata.isEmpty()) {
            return "";
        }
        Object value = metadata.get("leadName");
        if (value == null) {
            value = metadata.get("lead_name");
        }
        return trim(value == null ? "" : String.valueOf(value));
    }

    private boolean parseBooleanFlag(String raw) {
        String normalized = trim(raw).toLowerCase(Locale.ROOT);
        return "true".equals(normalized)
            || "1".equals(normalized)
            || "yes".equals(normalized)
            || "on".equals(normalized)
            || "enabled".equals(normalized);
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

    private String normalizeSubject(String subject) {
        String normalized = subject == null ? "" : subject.trim();
        return normalized.isBlank() ? "NexaCRM message" : normalized;
    }

    private boolean isDuplicateInboundEvent(String channel, String externalId) {
        String normalizedExternalId = trim(externalId);
        if (normalizedExternalId.isBlank()) {
            return false;
        }
        try {
            boolean duplicate = communicationRecordRepository.existsByTenantIdAndChannelIgnoreCaseAndExternalId(
                tenantId(),
                channel,
                normalizedExternalId
            );
            if (duplicate) {
                log.debug("Duplicate inbound {} event skipped for externalId={}", channel, normalizedExternalId);
            }
            return duplicate;
        } catch (Exception ex) {
            log.warn("Duplicate check failed for {} externalId={}: {}", channel, normalizedExternalId, ex.getMessage());
            return false;
        }
    }

    private void sendAutoReplySafely(String channel, String recipient) {
        if (!autoReplyEnabled) {
            return;
        }
        String replyText = trim(autoReplyMessage);
        if (replyText.isBlank()) {
            return;
        }
        try {
            sendSocialMessage(channel, recipient, replyText);
            log.info("Auto-reply sent on {} to {}", channel, recipient);
        } catch (Exception ex) {
            log.warn("Auto-reply failed on {} to {}: {}", channel, recipient, ex.getMessage());
        }
    }

    private String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private void persistCommunication(
        String channel,
        String direction,
        String contactIdentifier,
        String body,
        String status,
        String externalId,
        String rawPayload,
        String provider
    ) {
        persistCommunication(channel, direction, contactIdentifier, body, status, externalId, rawPayload, provider, null, null);
    }

    private void persistCommunication(
        String channel,
        String direction,
        String contactIdentifier,
        String body,
        String status,
        String externalId,
        String rawPayload,
        String provider,
        String contactName
    ) {
        persistCommunication(channel, direction, contactIdentifier, body, status, externalId, rawPayload, provider, contactName, null);
    }

    private void persistCommunication(
        String channel,
        String direction,
        String contactIdentifier,
        String body,
        String status,
        String externalId,
        String rawPayload,
        String provider,
        String contactName,
        String leadId
    ) {
        CommunicationRecord record = new CommunicationRecord();
        record.setTenantId(tenantId());
        record.setChannel(channel);
        record.setDirection(direction);
        record.setBody(body);
        record.setStatus(trim(status).isBlank() ? "SENT" : trim(status).toUpperCase(Locale.ROOT));
        record.setExternalId(trim(externalId));
        String normalizedChannel = trim(channel).toUpperCase(Locale.ROOT);
        if ("WHATSAPP".equals(normalizedChannel) || "FACEBOOK".equals(normalizedChannel)) {
            record.setContactIdentifier(normalizeContact(contactIdentifier));
        } else {
            record.setContactIdentifier(trim(contactIdentifier));
        }
        String normalizedName = trim(contactName);
        if (!normalizedName.isBlank()) {
            record.setContactName(normalizedName);
        }
        record.setProvider(provider);
        record.setRawPayload(rawPayload);
        String normalizedLeadId = trim(leadId);
        if (!normalizedLeadId.isBlank()) {
            record.setLeadId(normalizedLeadId);
        }
        record.setCreatedAt(Instant.now());
        communicationRecordRepository.save(record);
    }

    private boolean tryPersistCommunication(
        String channel,
        String direction,
        String contactIdentifier,
        String body,
        String status,
        String externalId,
        String rawPayload,
        String provider
    ) {
        return tryPersistCommunication(channel, direction, contactIdentifier, body, status, externalId, rawPayload, provider, null, null);
    }

    private boolean tryPersistCommunication(
        String channel,
        String direction,
        String contactIdentifier,
        String body,
        String status,
        String externalId,
        String rawPayload,
        String provider,
        String contactName
    ) {
        return tryPersistCommunication(
            channel,
            direction,
            contactIdentifier,
            body,
            status,
            externalId,
            rawPayload,
            provider,
            contactName,
            null
        );
    }

    private boolean tryPersistCommunication(
        String channel,
        String direction,
        String contactIdentifier,
        String body,
        String status,
        String externalId,
        String rawPayload,
        String provider,
        String contactName,
        String leadId
    ) {
        try {
            persistCommunication(channel, direction, contactIdentifier, body, status, externalId, rawPayload, provider, contactName, leadId);
            return true;
        } catch (Exception ex) {
            log.warn(
                "Communication persistence failed for {} {}: {}",
                channel,
                contactIdentifier,
                ex.getMessage(),
                ex
            );
            return false;
        }
    }

    private void notifyOutboundCommunication(String channel, String recipient, String body) {
        try {
            notificationService.notifyOutboundMessage(channel, recipient, body);
        } catch (Exception ex) {
            log.warn("Outbound notification failed for {} {}: {}", channel, recipient, ex.getMessage());
        }
    }

    private String combineEmailPreview(String subject, String body) {
        String trimmedSubject = trim(subject);
        String trimmedBody = trim(body);
        if (trimmedSubject.isBlank()) {
            return trimmedBody;
        }
        if (trimmedBody.isBlank()) {
            return trimmedSubject;
        }
        return trimmedSubject + " — " + trimmedBody;
    }

    public List<WhatsAppMessageResponse> getAllWhatsAppMessages() {
        return communicationRecordRepository
            .findByTenantIdAndChannelIgnoreCaseOrderByCreatedAtDesc(tenantId(), "WHATSAPP", PageRequest.of(0, 500))
            .stream()
            .map(this::toMessageResponse)
            .toList();
    }

    private WhatsAppMessageResponse toMessageResponse(CommunicationRecord row) {
        return WhatsAppMessageResponse.builder()
            .id(row.getId())
            .contact(row.getContactIdentifier())
            .contactName(row.getContactName())
            .direction(row.getDirection())
            .body(row.getBody())
            .status(row.getStatus())
            .externalId(row.getExternalId())
            .createdAt(asUtcOffsetDateTime(row.getCreatedAt()))
            .build();
    }

    private static final java.time.ZoneId IST = java.time.ZoneId.of("Asia/Kolkata");

    private OffsetDateTime asUtcOffsetDateTime(Instant timestamp) {
        return timestamp == null ? null : timestamp.atZone(IST).toOffsetDateTime();
    }

    private String resolveFacebookDisplayName(CommunicationRecord row) {
        String existing = trim(row.getContactName());
        if (!existing.isBlank()) {
            return existing;
        }
        String psid = trim(row.getContactIdentifier());
        String resolved = resolveFacebookProfileName(psid);
        return resolved.isBlank() ? "PSID: " + psid : resolved;
    }

    private String resolveWhatsAppDisplayName(CommunicationRecord row) {
        String existing = trim(row.getContactName());
        String contact = normalizeContact(row.getContactIdentifier());
        if (!existing.isBlank() && !isPhoneOnlyName(existing, contact)) {
            return existing;
        }
        if (contact.isBlank()) {
            return "";
        }

        for (String candidate : phoneLookupCandidates(contact)) {
            Optional<Lead> lead = leadRepository.findFirstByPhoneAndTenantIdAndDeletedFalseOrderByUpdatedAtDesc(candidate, tenantId());
            if (lead.isPresent()) {
                String name = trim(lead.get().getName());
                if (!name.isBlank()) {
                    return name;
                }
            }
            Optional<Customer> customer = customerRepository.findFirstByPhoneAndTenantIdAndDeletedFalseOrderByUpdatedAtDesc(candidate, tenantId());
            if (customer.isPresent()) {
                String name = trim(customer.get().getName());
                if (!name.isBlank()) {
                    return name;
                }
            }
        }

        return "+" + contact;
    }

    private boolean isPhoneOnlyName(String name, String phone) {
        String normalizedName = normalizeContact(name);
        String normalizedPhone = normalizeContact(phone);
        return !normalizedName.isBlank() && normalizedName.equals(normalizedPhone);
    }

    private List<String> phoneLookupCandidates(String contact) {
        String normalized = normalizeContact(contact);
        if (normalized.isBlank()) {
            return List.of();
        }
        List<String> candidates = new ArrayList<>();
        candidates.add(normalized);
        candidates.add("+" + normalized);
        if (normalized.startsWith("91") && normalized.length() > 10) {
            String local = normalized.substring(2);
            candidates.add(local);
            candidates.add("+91 " + local);
            candidates.add("+91" + local);
        }
        return candidates.stream().distinct().toList();
    }

    private String resolveFacebookProfileName(String psidRaw) {
        String psid = psidRaw == null ? "" : psidRaw.replaceAll("\\D", "");
        if (psid.isBlank()) {
            return "";
        }
        String cached = trim(facebookNameCache.get(psid));
        if (!cached.isBlank()) {
            return cached;
        }

        String accessToken = trim(integrationService.getConfig("facebook").get("accessToken"));
        if (accessToken.isBlank()) {
            accessToken = trim(defaultFacebookPageAccessToken);
        }
        if (accessToken.isBlank()) {
            return "";
        }

        try {
            String url = UriComponentsBuilder
                .fromHttpUrl("https://graph.facebook.com/{version}/{psid}")
                .queryParam("fields", "name,first_name,last_name")
                .queryParam("access_token", accessToken)
                .buildAndExpand(metaGraphApiVersion, psid)
                .toUriString();
            @SuppressWarnings("unchecked")
            Map<String, Object> profile = restTemplate.getForObject(url, Map.class);
            if (profile == null) return "";

            String name = trim(asText(profile.get("name")));
            if (name.isBlank()) {
                String first = trim(asText(profile.get("first_name")));
                String last = trim(asText(profile.get("last_name")));
                name = trim((first + " " + last).trim());
            }

            if (!name.isBlank()) {
                facebookNameCache.put(psid, name);
            }
            return name;
        } catch (Exception ex) {
            log.debug("Could not resolve Facebook profile name for PSID {}: {}", psid, ex.getMessage());
            return "";
        }
    }

    private String resolveInstagramDisplayName(CommunicationRecord row) {
        String existing = trim(row.getContactName());
        if (!existing.isBlank()) {
            return existing;
        }
        String igsid = trim(row.getContactIdentifier());
        String cached = trim(instagramNameCache.get(igsid));
        if (!cached.isBlank()) {
            return cached;
        }
        return "IG: " + igsid;
    }

    private String extractInstagramDisplayName(JsonNode event, String igsid) {
        String[] options = {
            event.at("/sender/username").asText(""),
            event.at("/sender/name").asText(""),
            event.at("/sender/profile_name").asText("")
        };
        for (String option : options) {
            String value = trim(option);
            if (!value.isBlank()) {
                instagramNameCache.put(igsid, value);
                return value;
            }
        }
        return trim(instagramNameCache.getOrDefault(igsid, ""));
    }

    private String asText(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private List<JsonNode> collectCandidates(JsonNode root) {
        List<JsonNode> candidates = new ArrayList<>();

        JsonNode messages = root.path("messages");
        if (messages.isArray()) {
            messages.forEach(candidates::add);
        }

        JsonNode data = root.path("data");
        if (data.isArray()) {
            data.forEach(candidates::add);
        } else if (data.isObject()) {
            candidates.add(data);
        }

        JsonNode message = root.path("message");
        if (message.isArray()) {
            message.forEach(candidates::add);
        } else if (message.isObject()) {
            candidates.add(message);
        }

        if (candidates.isEmpty()) {
            candidates.add(root);
        }
        return candidates;
    }

    private String extractDirection(JsonNode node) {
        JsonNode direction = node.path("direction");
        if (direction.isTextual()) {
            String raw = trim(direction.asText(""));
            if ("out".equalsIgnoreCase(raw) || "outgoing".equalsIgnoreCase(raw) || "sent".equalsIgnoreCase(raw)) {
                return "OUT";
            }
            if ("in".equalsIgnoreCase(raw) || "incoming".equalsIgnoreCase(raw) || "received".equalsIgnoreCase(raw)) {
                return "IN";
            }
        }
        JsonNode fromMeDirect = node.path("fromMe");
        if (fromMeDirect.isBoolean() && fromMeDirect.booleanValue()) {
            return "OUT";
        }
        JsonNode fromMe = node.at("/key/fromMe");
        if (fromMe.isBoolean() && fromMe.booleanValue()) {
            return "OUT";
        }
        return "IN";
    }

    private String extractContact(JsonNode node) {
        String[] options = {
            node.at("/key/remoteJid").asText(""),
            node.at("/key/participant").asText(""),
            node.at("/chat/id").asText(""),
            node.at("/chat/jid").asText(""),
            node.path("from").asText(""),
            node.path("to").asText(""),
            node.path("sender").asText(""),
            node.path("recipient").asText(""),
            node.path("number").asText(""),
            node.path("chatId").asText(""),
            node.path("jid").asText(""),
            node.path("author").asText(""),
            node.path("remoteJid").asText("")
        };
        for (String option : options) {
            String normalized = normalizeContact(option);
            if (!normalized.isBlank()) {
                return normalized;
            }
        }
        return "";
    }

    private String extractText(JsonNode node) {
        String[] options = {
            node.at("/message/conversation").asText(""),
            node.at("/message/extendedTextMessage/text").asText(""),
            node.at("/message/text").asText(""),
            node.at("/messageTemplate/text").asText(""),
            node.at("/data/text").asText(""),
            node.at("/data/body").asText(""),
            node.path("text").asText(""),
            node.path("body").asText(""),
            node.path("caption").asText(""),
            node.path("message").asText(""),
            node.path("msg").asText(""),
            node.path("content").asText("")
        };
        for (String option : options) {
            String value = trim(option);
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String extractExternalId(JsonNode node) {
        String id = trim(node.at("/key/id").asText(""));
        if (!id.isBlank()) {
            return id;
        }
        return trim(node.path("id").asText(""));
    }

    private String extractStatus(JsonNode node) {
        String status = trim(node.path("status").asText(""));
        return status.isBlank() ? "RECEIVED" : status;
    }

    private String normalizeContact(String raw) {
        String value = trim(raw);
        if (value.contains("@")) {
            value = value.substring(0, value.indexOf('@'));
        }
        value = value.replaceAll("\\D", "");
        return value;
    }

    private String toJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (Exception ignored) {
            return "";
        }
    }

    public record VoiceAgentConfig(
        boolean enabled,
        boolean autoCallOnLeadCreate,
        String provider,
        String webhookUrl,
        String apiKey,
        String agentId,
        String fromNumber,
        String webhookSecret,
        String callbackWebhookUrl,
        String bolnaApiUrl,
        String bolnaApiKey,
        String bolnaAgentId,
        String bolnaVoiceId,
        String twilioAccountSid,
        String twilioAuthToken,
        String twilioFromNumber,
        String twilioPhoneNumbers,
        String telephonyProvider
    ) { }
}
