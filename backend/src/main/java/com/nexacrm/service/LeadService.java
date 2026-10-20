package com.nexacrm.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nexacrm.automation.WorkflowEngine;
import com.nexacrm.dto.LeadDTO;
import com.nexacrm.dto.LeadPipelineBoardDTO;
import com.nexacrm.dto.PageResponse;
import com.nexacrm.exception.ResourceNotFoundException;
import com.nexacrm.model.Customer;
import com.nexacrm.model.Deal;
import com.nexacrm.model.Lead;
import com.nexacrm.model.User;
import com.nexacrm.repository.CustomerRepository;
import com.nexacrm.repository.DealRepository;
import com.nexacrm.repository.LeadRepository;
import com.nexacrm.repository.UserRepository;
import com.nexacrm.security.TenantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Caching;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.StringJoiner;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class LeadService {

    private static final String LEAD_IMPORT_SUPPRESSIONS_COLLECTION = "lead_import_suppressions";
    private static final String META_ADS_SOURCE = "META_ADS";

    private final LeadRepository leadRepository;
    private final LeadChangeAuditService leadChangeAuditService;
    private final CustomerRepository customerRepository;
    private final DealRepository dealRepository;
    private final UserRepository userRepository;
    private final MongoTemplate mongoTemplate;
    private final NotificationService notificationService;
    private final WorkflowEngine workflowEngine;
    private final CommunicationService communicationService;
    private final LeadCallAutomationService leadCallAutomationService;
    private final IntegrationService integrationService;
    private final LeadAutoAssignService leadAutoAssignService;
    private final LeadActivityService leadActivityService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Value("${meta.page-access-token}")
    private String pageAccessToken;

    @Value("${meta.page-id:}")
    private String envPageId;

    @Value("${meta.graph-api-version:v19.0}")
    private String graphApiVersion;

    // ── Queries ──────────────────────────────────────────────────

    private Long tenantId() {
        return TenantContext.currentTenantId();
    }

    private User currentUser() {
        var authentication = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        Object principal = authentication != null ? authentication.getPrincipal() : null;
        Long tenantId = tenantId();
        if (principal instanceof User user
            && user.getTenantId() != null
            && user.getTenantId().equals(tenantId)
            && !Boolean.TRUE.equals(user.getDeleted())) {
            return user;
        }
        String email = authentication != null ? authentication.getName() : null;
        return userRepository.findByEmailAndTenantIdAndDeletedFalse(email, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Authenticated user not found"));
    }

    @Transactional(readOnly = true)
    public PageResponse<LeadDTO> findAll(String search, String status, String score,
                                         String source, String assignedTo, Pageable pageable) {
        long started = System.nanoTime();
        Pageable effectivePageable = normalizeLeadListPageable(pageable);
        Query query = new Query();
        query.addCriteria(Criteria.where("tenant_id").is(tenantId()));
        query.addCriteria(Criteria.where("deleted").is(false));
        User current = currentUser();
        long userLoaded = System.nanoTime();
        if (!User.isAdminLike(current.getRole()) && current.getRole() != User.Role.MANAGER) {
            query.addCriteria(Criteria.where("assigned_to.$id").is(current.getId()));
        }

        if (search != null && !search.isBlank()) {
            query.addCriteria(buildLeadSearchCriteria(search.trim()));
        }
        if (status != null && !status.isBlank()) {
            query.addCriteria(Criteria.where("status").is(Lead.LeadStatus.valueOf(status.toUpperCase())));
        }
        if (score != null && !score.isBlank()) {
            query.addCriteria(Criteria.where("score").is(Lead.LeadScore.valueOf(score.toUpperCase())));
        }
        if (source != null && !source.isBlank()) {
            query.addCriteria(Criteria.where("source").is(Lead.LeadSource.valueOf(source.toUpperCase())));
        }
        if (assignedTo != null && !assignedTo.isBlank()) {
            query.addCriteria(Criteria.where("assigned_to.$id").is(assignedTo));
        }

        query.with(effectivePageable);
        query.limit(effectivePageable.getPageSize() + 1);
        includeLeadListFields(query);
        List<org.bson.Document> leadDocs = mongoTemplate.find(query, org.bson.Document.class, "leads");
        long leadsLoaded = System.nanoTime();
        boolean hasMore = leadDocs.size() > effectivePageable.getPageSize();
        if (hasMore) {
            leadDocs = leadDocs.subList(0, effectivePageable.getPageSize());
        }
        long loadedThrough = effectivePageable.getOffset() + leadDocs.size();
        long total = loadedThrough + (hasMore ? 1 : 0);
        Set<String> assignedIds = leadDocs.stream()
            .map(this::assignedToIdFromDoc)
            .filter(id -> id != null && !id.isBlank())
            .collect(Collectors.toCollection(LinkedHashSet::new));

        Map<String, String> assignedNameById = assignedIds.isEmpty()
            ? Map.of()
            : userRepository.findAllById(assignedIds).stream()
                .collect(Collectors.toMap(
                    user -> user.getId(),
                    user -> user.getName(),
                    (existing, replacement) -> existing
                ));
        long assignedUsersLoaded = System.nanoTime();
        PageResponse<LeadDTO> response = PageResponse.<LeadDTO>builder()
            .content(leadDocs.stream()
                .map(doc -> toListDTO(doc, assignedNameById, Map.of()))
                .collect(Collectors.toList()))
            .page(effectivePageable.getPageNumber())
            .size(effectivePageable.getPageSize())
            .total(total)
            .totalPages(effectivePageable.getPageSize() <= 0 ? 1 : (int) Math.ceil((double) total / effectivePageable.getPageSize()))
            .first(effectivePageable.getPageNumber() == 0)
            .last(!hasMore)
            .build();
        long completed = System.nanoTime();
        long totalMs = Duration.ofNanos(completed - started).toMillis();
        if (totalMs > 1_000) {
            log.warn(
                "Slow lead list load: tenant={}, page={}, size={}, rows={}, userMs={}, queryMs={}, assignedUserMs={}, mapMs={}, totalMs={}",
                tenantId(),
                effectivePageable.getPageNumber(),
                effectivePageable.getPageSize(),
                leadDocs.size(),
                Duration.ofNanos(userLoaded - started).toMillis(),
                Duration.ofNanos(leadsLoaded - userLoaded).toMillis(),
                Duration.ofNanos(assignedUsersLoaded - leadsLoaded).toMillis(),
                Duration.ofNanos(completed - assignedUsersLoaded).toMillis(),
                totalMs
            );
        }
        return response;
    }

    private Pageable normalizeLeadListPageable(Pageable pageable) {
        int page = pageable != null ? pageable.getPageNumber() : 0;
        int size = pageable != null ? pageable.getPageSize() : 20;
        Sort sort = pageable != null && pageable.getSort().isSorted()
            ? pageable.getSort()
            : Sort.by(Sort.Direction.DESC, "createdAt");
        return PageRequest.of(page, size, sort);
    }

    private Criteria buildLeadSearchCriteria(String rawSearch) {
        Pattern textPattern = Pattern.compile(Pattern.quote(rawSearch), Pattern.CASE_INSENSITIVE);
        Criteria[] criteria = new Criteria[] {
            Criteria.where("name").regex(textPattern),
            Criteria.where("company").regex(textPattern),
            Criteria.where("email").regex(textPattern),
            Criteria.where("phone").regex(phoneSearchPattern(rawSearch)),
        };
        return new Criteria().orOperator(criteria);
    }

    private Pattern phoneSearchPattern(String rawSearch) {
        String digits = rawSearch.replaceAll("\\D", "");
        if (digits.length() >= 3) {
            StringBuilder expression = new StringBuilder();
            for (int i = 0; i < digits.length(); i++) {
                if (i > 0) expression.append("\\D*");
                expression.append(Pattern.quote(String.valueOf(digits.charAt(i))));
            }
            return Pattern.compile(expression.toString(), Pattern.CASE_INSENSITIVE);
        }
        return Pattern.compile(Pattern.quote(rawSearch), Pattern.CASE_INSENSITIVE);
    }

    @Transactional(readOnly = true)
    public LeadPipelineBoardDTO findPipelineBoard(String search, String status, String score,
                                                  String source, String assignedTo, Pageable pageable) {
        long started = System.nanoTime();
        PageResponse<LeadDTO> leadPage = findAll(search, status, score, source, assignedTo, pageable);
        long leadsLoaded = System.nanoTime();
        List<String> leadIds = leadPage.getContent() == null
            ? List.of()
            : leadPage.getContent().stream()
                .map(LeadDTO::getId)
                .filter(id -> id != null && !id.isBlank())
                .toList();
        Map<String, List<com.nexacrm.dto.LeadActivityDTO>> activities = leadActivityService.listVisibleLeadIds(leadIds);
        long activitiesLoaded = System.nanoTime();
        long leadMs = Duration.ofNanos(leadsLoaded - started).toMillis();
        long activityMs = Duration.ofNanos(activitiesLoaded - leadsLoaded).toMillis();
        long totalMs = Duration.ofNanos(activitiesLoaded - started).toMillis();
        if (totalMs > 2_000) {
            log.warn(
                "Slow pipeline board load: tenant={}, page={}, size={}, leads={}, leadMs={}, activityMs={}, totalMs={}",
                tenantId(),
                pageable != null ? pageable.getPageNumber() : 0,
                pageable != null ? pageable.getPageSize() : 0,
                leadIds.size(),
                leadMs,
                activityMs,
                totalMs
            );
        }

        return LeadPipelineBoardDTO.builder()
            .content(leadPage.getContent())
            .activities(activities)
            .page(leadPage.getPage())
            .size(leadPage.getSize())
            .total(leadPage.getTotal())
            .totalPages(leadPage.getTotalPages())
            .first(leadPage.isFirst())
            .last(leadPage.isLast())
            .build();
    }

    @Transactional(readOnly = true)
    public LeadDTO findById(String id) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);
        return toDTO(lead);
    }

    // ── Commands ─────────────────────────────────────────────────

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public LeadDTO create(LeadDTO dto) {
        String normalizedEmail = normalizeEmail(dto.getEmail());
        if (normalizedEmail == null || normalizedEmail.isBlank()) {
            throw new IllegalStateException("Email is required");
        }
        String normalizedPhone = normalizePhone(dto.getPhone());

        Long tenantId = tenantId();
        if (dto.getFacebookLeadId() != null && !dto.getFacebookLeadId().isBlank()) {
            Optional<Lead> existingFacebookLead = leadRepository.findByFacebookLeadIdAndTenantIdAndDeletedFalse(
                dto.getFacebookLeadId().trim(),
                tenantId
            );
            if (existingFacebookLead.isPresent()) {
                Lead existing = existingFacebookLead.get();
                log.info("Lead create skipped because Facebook lead already exists: id={}", existing.getId());
                return toDTO(existing);
            }
        }

        leadRepository.findByEmailAndTenantIdAndDeletedFalse(normalizedEmail, tenantId)
            .ifPresent(existing -> {
                throw new IllegalStateException("Lead with email already exists: " + normalizedEmail);
            });
        if (normalizedPhone != null && !normalizedPhone.isBlank()) {
            leadRepository.findByPhoneAndTenantIdAndDeletedFalse(normalizedPhone, tenantId)
                .ifPresent(existing -> {
                    throw new IllegalStateException("Lead with phone already exists: " + normalizedPhone);
                });
        }

        dto.setEmail(normalizedEmail);
        dto.setPhone(normalizedPhone);

        Lead lead = fromDTO(dto);
        lead.setTenantId(tenantId);
        validateLostReason(lead);
        Lead saved;
        try {
            saved = leadChangeAuditService.save(lead);
        } catch (DuplicateKeyException ex) {
            throw new IllegalStateException("Lead already exists with that email, phone, or external ID", ex);
        }

        if (saved.getAssignedTo() == null) {
            try {
                User assignee = leadAutoAssignService.autoAssignAndCreateTask(saved, tenantId);
                if (assignee != null) {
                    saved.setAssignedTo(assignee);
                    saved = leadChangeAuditService.save(saved);
                }
            } catch (Exception ex) {
                log.warn("Auto-assign failed for lead {}: {}", saved.getId(), ex.getMessage());
            }
        }

        notificationService.notifyLeadCreated(
            saved.getName(),
            saved.getSource() != null ? saved.getSource().name() : "OTHER",
            saved.getId()
        );
        workflowEngine.processEvent("LEAD_CREATED", Map.of(
            "leadId", saved.getId(),
            "leadName", saved.getName() != null ? saved.getName() : "",
            "leadEmail", saved.getEmail() != null ? saved.getEmail() : "",
            "leadPhone", saved.getPhone() != null ? saved.getPhone() : "",
            "source", saved.getSource() != null ? saved.getSource().name() : "OTHER",
            "status", saved.getStatus() != null ? saved.getStatus().name() : "NEW"
        ));
        Long currentTenantId = TenantContext.currentTenantId();
        leadCallAutomationService.startForNewLeadAsync(saved, currentTenantId);
        communicationService.autoWhatsAppNewLeadAsync(
            saved.getId(),
            saved.getName(),
            saved.getPhone(),
            saved.getCompany(),
            saved.getService(),
            saved.getSource() != null ? saved.getSource().name() : null,
            currentTenantId
        );
        communicationService.sendAdminNewLeadNotificationAsync(
            saved.getId(),
            saved.getName(),
            saved.getPhone(),
            saved.getEmail(),
            saved.getCompany(),
            saved.getService(),
            saved.getSource() != null ? saved.getSource().name() : null,
            saved.getDealValue() != null ? saved.getDealValue().toPlainString() : null,
            currentTenantId
        );

        log.info("Lead created: id={}, name={}", saved.getId(), saved.getName());
        return toDTO(saved);
    }

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public LeadDTO update(String id, LeadDTO dto) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);

        String normalizedEmail = dto.getEmail() != null ? normalizeEmail(dto.getEmail()) : lead.getEmail();
        if (normalizedEmail == null || normalizedEmail.isBlank()) {
            throw new IllegalStateException("Email is required");
        }
        String normalizedPhone = dto.getPhone() != null ? normalizePhone(dto.getPhone()) : lead.getPhone();
        if (dto.getEmail() != null && !normalizedEmail.equalsIgnoreCase(lead.getEmail())) {
            leadRepository.findByEmailAndTenantIdAndDeletedFalse(normalizedEmail, tenantId())
                .ifPresent(existing -> {
                    throw new IllegalStateException("Lead with email already exists: " + normalizedEmail);
                });
        }
        if (dto.getPhone() != null && normalizedPhone != null && !normalizedPhone.isBlank() && !normalizedPhone.equals(lead.getPhone())) {
            leadRepository.findByPhoneAndTenantIdAndDeletedFalse(normalizedPhone, tenantId())
                .ifPresent(existing -> {
                    throw new IllegalStateException("Lead with phone already exists: " + normalizedPhone);
                });
        }

        if (dto.getName() != null) lead.setName(dto.getName());
        if (dto.getEmail() != null) lead.setEmail(normalizedEmail);
        if (dto.getPhone() != null) lead.setPhone(normalizedPhone);
        if (dto.getCompany() != null) lead.setCompany(dto.getCompany());
        if (dto.getService() != null) lead.setService(dto.getService());
        if (dto.getSpecialization() != null) lead.setSpecialization(dto.getSpecialization());
        if (dto.getSource() != null) {
            Lead.LeadSource previousSource = lead.getSource();
            Lead.LeadSource nextSource = dto.getSource();
            lead.setSource(nextSource);
            if (dto.getSourceLabel() != null) {
                lead.setSourceLabel(normalizeSourceLabel(nextSource, dto.getSourceLabel()));
            } else if (previousSource != nextSource || (nextSource != Lead.LeadSource.OTHER && nextSource != Lead.LeadSource.REFERRAL)) {
                lead.setSourceLabel(null);
            }
        } else if (dto.getSourceLabel() != null) {
            lead.setSourceLabel(normalizeSourceLabel(lead.getSource(), dto.getSourceLabel()));
        }
        if (dto.getStatus() != null) lead.setStatus(dto.getStatus());
        if (dto.getScore() != null)  lead.setScore(dto.getScore());
        if (dto.getPriority() != null) lead.setPriority(dto.getPriority());
        if (dto.getExpectedCloseTimeline() != null) {
            lead.setExpectedCloseTimeline(dto.getExpectedCloseTimeline());
            lead.setScore(scoreFromTimeline(dto.getExpectedCloseTimeline()));
        }
        if (dto.getDealValue() != null) lead.setDealValue(dto.getDealValue());
        if (dto.getAssignedToId() != null) {
            if (dto.getAssignedToId().isBlank()) {
                lead.setAssignedTo(null);
            } else {
                userRepository.findByIdAndTenantIdAndDeletedFalse(dto.getAssignedToId(), tenantId())
                    .ifPresent(lead::setAssignedTo);
            }
        }
        lead.setNotes(dto.getNotes());
        if (dto.getLastContactedAt() != null) {
            lead.setLastContactedAt(dto.getLastContactedAt());
        }
        if (dto.getConvertedAt() != null) {
            lead.setConvertedAt(dto.getConvertedAt());
        }
        if (dto.getLostReason() != null) {
            lead.setLostReason(dto.getLostReason());
        }
        if (dto.getFollowUpDate() != null) {
            lead.setFollowUpDate(dto.getFollowUpDate());
        }
        if (dto.getRevenueValue() != null) {
            lead.setRevenueValue(dto.getRevenueValue());
        }
        if (dto.getReminder15SentAt() != null) lead.setReminder15SentAt(dto.getReminder15SentAt());
        if (dto.getReminder45SentAt() != null) lead.setReminder45SentAt(dto.getReminder45SentAt());
        if (dto.getReminder60SentAt() != null) lead.setReminder60SentAt(dto.getReminder60SentAt());
        if (dto.getEscalatedAt() != null) lead.setEscalatedAt(dto.getEscalatedAt());
        if (dto.getReassignedAt() != null) lead.setReassignedAt(dto.getReassignedAt());
        validateLostReason(lead);

        try {
            return toDTO(leadChangeAuditService.save(lead));
        } catch (DuplicateKeyException ex) {
            throw new IllegalStateException("Lead already exists with that email, phone, or external ID", ex);
        }
    }

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public void delete(String id) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);
        hardDeleteLeadData(List.of(lead), tenantId());
    }

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public int bulkDelete(List<String> ids) {
        if (ids == null || ids.isEmpty()) return 0;
        Long tenantId = tenantId();
        List<String> validIds = ids.stream().filter(id -> id != null && !id.isBlank()).toList();
        List<Lead> leads = leadRepository.findByIdInAndTenantIdAndDeletedFalse(validIds, tenantId).stream()
            .filter(this::canCurrentUserAccess)
            .toList();
        hardDeleteLeadData(leads, tenantId);
        return leads.size();
    }

    private void hardDeleteLeadData(Collection<Lead> leads, Long tenantId) {
        if (leads == null || leads.isEmpty()) {
            return;
        }
        List<String> leadIds = leads.stream()
            .map(Lead::getId)
            .filter(id -> id != null && !id.isBlank())
            .distinct()
            .toList();
        if (leadIds.isEmpty()) {
            return;
        }

        rememberDeletedExternalLeads(leads, tenantId);
        leadIds.forEach(communicationService::cancelPendingLeadVoiceCalls);

        Query leadScoped = new Query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds));
        mongoTemplate.remove(leadScoped, "communications");
        mongoTemplate.remove(Query.query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds)), "lead_activities");
        mongoTemplate.remove(Query.query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds)), "lead_timeline_events");
        mongoTemplate.remove(Query.query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds)), "lead_call_automations");
        mongoTemplate.remove(Query.query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds)), "ai_calls");
        mongoTemplate.remove(Query.query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds)), "follow_ups");
        mongoTemplate.remove(Query.query(Criteria.where("tenant_id").is(tenantId).and("lead_id").in(leadIds)), "tasks");
        mongoTemplate.remove(
            Query.query(Criteria.where("tenant_id").is(tenantId).and("entity_type").is("lead").and("entity_id").in(leadIds)),
            "notifications"
        );
        leadRepository.deleteAll(leads);
    }

    private void rememberDeletedExternalLeads(Collection<Lead> leads, Long tenantId) {
        if (tenantId == null) {
            return;
        }
        leads.forEach(lead -> rememberDeletedMetaLead(lead, tenantId));
    }

    private void rememberDeletedMetaLead(Lead lead, Long tenantId) {
        if (lead == null) {
            return;
        }

        String facebookLeadId = trim(lead.getFacebookLeadId());
        if (facebookLeadId == null || facebookLeadId.isBlank()) {
            return;
        }

        LocalDateTime now = LocalDateTime.now();
        Query query = Query.query(Criteria.where("tenant_id").is(tenantId)
            .and("source").is(META_ADS_SOURCE)
            .and("external_id").is(facebookLeadId));

        Update update = new Update()
            .setOnInsert("tenant_id", tenantId)
            .setOnInsert("source", META_ADS_SOURCE)
            .setOnInsert("external_id", facebookLeadId)
            .setOnInsert("createdAt", now)
            .set("lead_name", lead.getName())
            .set("email", lead.getEmail())
            .set("phone", lead.getPhone())
            .set("reason", "lead_deleted")
            .set("deleted", false)
            .set("deleted_at", now)
            .set("updatedAt", now);

        mongoTemplate.upsert(query, update, LEAD_IMPORT_SUPPRESSIONS_COLLECTION);
    }

    @Transactional(readOnly = true)
    public List<LeadDTO> findDuplicates(String email, String phone, String excludeId) {
        String normalizedEmail = normalizeEmail(email);
        String normalizedPhone = normalizePhone(phone);
        if ((normalizedEmail == null || normalizedEmail.isBlank()) && (normalizedPhone == null || normalizedPhone.isBlank())) {
            return List.of();
        }

        // ponytail: targeted query instead of loading all leads
        Long tid = tenantId();
        List<Criteria> orCriteria = new ArrayList<>();
        if (normalizedEmail != null && !normalizedEmail.isBlank()) {
            orCriteria.add(Criteria.where("email").is(normalizedEmail));
        }
        if (normalizedPhone != null && !normalizedPhone.isBlank()) {
            orCriteria.add(Criteria.where("phone").is(normalizedPhone));
        }
        Query q = new Query(Criteria.where("tenant_id").is(tid).and("deleted").is(false));
        q.addCriteria(new Criteria().orOperator(orCriteria.toArray(new Criteria[0])));
        if (excludeId != null && !excludeId.isBlank()) {
            q.addCriteria(Criteria.where("_id").ne(excludeId));
        }
        return mongoTemplate.find(q, Lead.class).stream().map(this::toDTO).toList();
    }

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public LeadDTO merge(String primaryId, String duplicateId) {
        if (primaryId == null || duplicateId == null || primaryId.isBlank() || duplicateId.isBlank()) {
            throw new IllegalStateException("Both lead ids are required");
        }
        if (primaryId.equals(duplicateId)) {
            throw new IllegalStateException("Cannot merge a lead into itself");
        }

        Lead primary = leadRepository.findByIdAndTenantIdAndDeletedFalse(primaryId, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + primaryId));
        Lead duplicate = leadRepository.findByIdAndTenantIdAndDeletedFalse(duplicateId, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + duplicateId));
        ensureLeadVisible(primary);
        ensureLeadVisible(duplicate);

        mergeLeadFields(primary, duplicate);
        primary.setNotes(appendNote(primary.getNotes(), "\n\n[Merged Lead]\nMerged duplicate lead: " + duplicate.getName() + " (" + duplicate.getId() + ")"));
        primary.setActivityLogs(mergeActivityLogs(primary.getActivityLogs(), duplicate.getActivityLogs()));

        duplicate.setDeleted(true);
        leadChangeAuditService.save(duplicate);
        Lead saved = leadChangeAuditService.save(primary);
        return toDTO(saved);
    }

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public LeadDTO reopen(String id, Map<String, Object> options) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);

        lead.setStatus(Lead.LeadStatus.NEW);
        lead.setLostReason(null);
        lead.setConvertedAt(null);
        if (options != null) {
            String note = options.get("note") != null ? String.valueOf(options.get("note")).trim() : "";
            if (!note.isBlank()) {
                lead.setNotes(appendNote(lead.getNotes(), "\n\n[Reopened Lead]\n" + note));
            }
            String followUp = options.get("followUpDate") != null ? String.valueOf(options.get("followUpDate")).trim() : "";
            if (!followUp.isBlank()) {
                try {
                    lead.setFollowUpDate(LocalDateTime.parse(followUp));
                } catch (Exception ignored) {
                    // Keep current follow-up date if parsing fails.
                }
            }
        }

        return toDTO(leadChangeAuditService.save(lead));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> leadAging(String id) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);

        LocalDateTime reference = lead.getLastContactedAt() != null ? lead.getLastContactedAt() : lead.getCreatedAt();
        long ageMinutes = reference != null ? Duration.between(reference, LocalDateTime.now()).toMinutes() : 0;
        long untouchedMinutes = lead.getLastContactedAt() != null && lead.getCreatedAt() != null
            ? Duration.between(lead.getLastContactedAt(), LocalDateTime.now()).toMinutes()
            : ageMinutes;
        boolean stale = untouchedMinutes >= 60;
        boolean overdue = lead.getFollowUpDate() != null && lead.getFollowUpDate().isBefore(LocalDateTime.now());
        String slaState = overdue ? "BREACHED" : stale ? "AT_RISK" : "ON_TRACK";

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("leadId", lead.getId());
        row.put("ageMinutes", ageMinutes);
        row.put("ageHours", Math.round((ageMinutes / 60.0) * 10.0) / 10.0);
        row.put("untouchedMinutes", untouchedMinutes);
        row.put("stale", stale);
        row.put("overdueFollowUp", overdue);
        row.put("slaState", slaState);
        row.put("createdAt", lead.getCreatedAt());
        row.put("lastContactedAt", lead.getLastContactedAt());
        row.put("followUpDate", lead.getFollowUpDate());
        row.put("assignedToId", lead.getAssignedTo() != null ? lead.getAssignedTo().getId() : null);
        row.put("assignedToName", lead.getAssignedTo() != null ? lead.getAssignedTo().getName() : null);
        return row;
    }

    @Transactional(readOnly = true)
    public List<String> assignmentHistory(String id) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);
        return lead.getActivityLogs() != null ? lead.getActivityLogs() : List.of();
    }

    @CacheEvict(value = "leads-list", allEntries = true)
    public Map<String, Object> importFromFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalStateException("Import file is empty.");
        }

        String fileName = file.getOriginalFilename() != null ? file.getOriginalFilename().toLowerCase(Locale.ROOT) : "";
        String contentType = file.getContentType() != null ? file.getContentType().toLowerCase(Locale.ROOT) : "";
        List<List<String>> rows;
        try {
            if (fileName.endsWith(".xlsx") || contentType.contains("spreadsheetml.sheet")) {
                rows = parseExcel(file);
            } else if (fileName.endsWith(".csv") || contentType.contains("csv") || contentType.contains("plain")) {
                String csv = new String(file.getBytes(), StandardCharsets.UTF_8);
                rows = parseCsv(csv);
            } else {
                throw new IllegalStateException("Unsupported import file type. Only CSV and XLSX are allowed.");
            }
        } catch (IOException e) {
            throw new IllegalStateException("Unable to read import file.", e);
        }

        if (rows.isEmpty()) {
            return Map.of("imported", 0, "skipped", 0, "errors", 0, "message", "No rows found in file.");
        }

        Map<String, Integer> headerIndex = buildHeaderIndex(rows.get(0));
        List<String> errorList = new ArrayList<>();
        int imported = 0;
        int skipped = 0;

        for (int i = 1; i < rows.size(); i++) {
            List<String> row = rows.get(i);
            String name = readCell(row, headerIndex, "name", "full name");
            String email = readCell(row, headerIndex, "email");
            String phone = readCell(row, headerIndex, "phone", "mobile", "mobile number");
            String company = readCell(row, headerIndex, "company");
            String service = readCell(row, headerIndex, "service");
            String specialization = readCell(row, headerIndex, "specialization", "subservice", "sub service", "sub_service");
            String source = readCell(row, headerIndex, "source");
            String score = readCell(row, headerIndex, "score");
            String status = readCell(row, headerIndex, "status");
            String value = readCell(row, headerIndex, "value", "deal value", "dealvalue");
            String tags = readCell(row, headerIndex, "tags");
            String notes = readCell(row, headerIndex, "notes", "remark", "remarks");

            if (email == null || email.isBlank()) {
                skipped++;
                errorList.add("Row " + (i + 1) + ": missing email");
                continue;
            }

            String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
            if (leadRepository.findByEmailAndTenantIdAndDeletedFalse(normalizedEmail, tenantId()).isPresent()) {
                skipped++;
                continue;
            }

            try {
                LeadDTO dto = LeadDTO.builder()
                    .name((name == null || name.isBlank()) ? normalizedEmail : name.trim())
                    .email(normalizedEmail)
                    .phone(phone)
                    .company(company)
                    .service(service)
                    .specialization(specialization)
                    .source(parseSource(source))
                    .score(parseScore(score))
                    .status(parseStatus(status))
                    .dealValue(parseAmount(value))
                    .tags(parseTags(tags))
                    .notes(notes != null && !notes.isBlank() ? notes : "Imported from file")
                    .build();
                create(dto);
                imported++;
            } catch (Exception ex) {
                skipped++;
                errorList.add("Row " + (i + 1) + ": " + ex.getMessage());
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("imported", imported);
        result.put("skipped", skipped);
        result.put("errors", errorList.size());
        if (!errorList.isEmpty()) {
            result.put("errorDetails", errorList.size() > 20 ? errorList.subList(0, 20) : errorList);
        }
        return result;
    }

    @CacheEvict(value = "leads-list", allEntries = true)
    public Map<String, Object> syncFromPublicGoogleSheet(Map<String, String> config) {
        String sourceLabel = trim(config.get("sourceLabel"));
        if (sourceLabel == null || sourceLabel.isBlank()) sourceLabel = "Kriscel.com";
        String sheetName = trim(config.get("sheetName"));

        String csv = fetchPublicSheetCsv(config);

        List<List<String>> rows = parseCsv(csv);
        if (rows.isEmpty()) {
            return Map.of(
                "ok", true,
                "message", "No rows found in sheet.",
                "imported", 0,
                "skipped", 0,
                "errors", 0
            );
        }

        Map<String, Integer> headerIndex = buildHeaderIndex(rows.get(0));
        List<String> errorList = new ArrayList<>();
        int imported = 0;
        int skipped = 0;

        for (int i = 1; i < rows.size(); i++) {
            List<String> row = rows.get(i);
            String name = readCell(row, headerIndex, "name");
            String email = readCell(row, headerIndex, "email");
            String phone = readCell(row, headerIndex, "phone");
            String service = readCell(row, headerIndex, "service");
            String specialization = readCell(row, headerIndex, "specialization", "subservice", "sub service", "sub_service");
            String subject = readCell(row, headerIndex, "subject");
            String message = readCell(row, headerIndex, "message");
            String date = readCell(row, headerIndex, "date");

            if ((name == null || name.isBlank()) && (email == null || email.isBlank())) {
                skipped++;
                continue;
            }
            if (email == null || email.isBlank()) {
                skipped++;
                errorList.add("Row " + (i + 1) + ": missing email");
                continue;
            }

            String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
            if (leadRepository.findByEmailAndTenantIdAndDeletedFalse(normalizedEmail, tenantId()).isPresent()) {
                skipped++;
                continue;
            }

            String note = mergeNotes(subject, message, date);
            LeadDTO dto = LeadDTO.builder()
                .name(name != null && !name.isBlank() ? name.trim() : normalizedEmail)
                .email(normalizedEmail)
                .phone(phone)
                .service(service)
                .specialization(specialization)
                .source(Lead.LeadSource.WEBSITE)
                .status(Lead.LeadStatus.NEW)
                .utmSource("kriscel.com")
                .utmMedium("google_sheet_sync")
                .utmCampaign(sourceLabel)
                .notes(note)
                .build();

            try {
                create(dto);
                imported++;
            } catch (Exception ex) {
                skipped++;
                errorList.add("Row " + (i + 1) + ": " + ex.getMessage());
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("message", "Google Sheet sync complete.");
        result.put("sheet", sheetName);
        result.put("imported", imported);
        result.put("skipped", skipped);
        result.put("errors", errorList.size());
        if (!errorList.isEmpty()) {
            result.put("errorDetails", errorList.size() > 20 ? errorList.subList(0, 20) : errorList);
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    @CacheEvict(value = "leads-list", allEntries = true)
    public Map<String, Object> syncFacebookLeadAds(Map<String, String> options) {
        Map<String, String> config = new LinkedHashMap<>(integrationService.getConfig("facebook"));
        if (options != null) {
            options.forEach((k, v) -> {
                if (k != null && v != null && !v.isBlank()) {
                    config.put(k, v.trim());
                }
            });
        }

        String pageId = trim(config.get("pageId"));
        if (pageId == null || pageId.isBlank()) {
            pageId = trim(envPageId);
        }
        if (pageId == null || pageId.isBlank()) {
            throw new IllegalStateException("Facebook pageId is missing. Set it in Integrations > Facebook or META_PAGE_ID.");
        }

        String accessToken = resolveFacebookLeadAccessTokenForPage(
            pageId,
            trim(config.get("accessToken"))
        );
        if (accessToken == null || accessToken.isBlank()) {
            throw new IllegalStateException("Facebook access token is missing. Set it in Integrations > Facebook or META_PAGE_ACCESS_TOKEN.");
        }

        String requestedFormId = trim(config.get("formId"));
        int formPageSize = parsePositiveInt(config.get("formPageSize"), 50);
        int leadPageSize = parsePositiveInt(config.get("leadPageSize"), 100);
        boolean includeArchived = parseBoolean(config.get("includeArchived"), true);

        int formsProcessed = 0;
        int leadsFetched = 0;
        int imported = 0;
        int merged = 0;
        int skipped = 0;
        List<String> errors = new ArrayList<>();

        String formsUrl = "https://graph.facebook.com/" + graphApiVersion + "/" + pageId
            + "/leadgen_forms?fields=id,name,status,created_time&limit=" + formPageSize
            + "&access_token=" + accessToken;

        log.info("Facebook lead sync starting for pageId={}, apiVersion={}, tokenLen={}",
            pageId, graphApiVersion, accessToken != null ? accessToken.length() : 0);

        while (formsUrl != null && !formsUrl.isBlank()) {
            Map<String, Object> formsResponse;
            try {
                formsResponse = restTemplate.getForObject(URI.create(formsUrl), Map.class);
            } catch (RestClientResponseException ex) {
                if (isFacebookPageAccessTokenRequiredError(ex)) {
                    throw new IllegalStateException(
                        "Facebook lead sync requires a Page Access Token for pageId=" + pageId
                            + ". Update Integrations > Facebook with that page token (not a user/app token), "
                            + "or provide META_PAGE_ACCESS_TOKEN.",
                        ex
                    );
                }
                throw new IllegalStateException("Failed to fetch Facebook lead forms: " + ex.getResponseBodyAsString(), ex);
            } catch (Exception ex) {
                throw new IllegalStateException("Failed to fetch Facebook lead forms: " + ex.getMessage(), ex);
            }

            List<Map<String, Object>> forms = formsResponse != null && formsResponse.get("data") instanceof List<?>
                ? (List<Map<String, Object>>) formsResponse.get("data")
                : List.of();

            for (Map<String, Object> form : forms) {
                String formId = trim(String.valueOf(form.get("id")));
                if (formId == null || formId.isBlank()) continue;

                if (requestedFormId != null && !requestedFormId.isBlank() && !requestedFormId.equals(formId)) {
                    continue;
                }

                String status = trim(String.valueOf(form.get("status")));
                if (!includeArchived && status != null && !status.isBlank() && !"ACTIVE".equalsIgnoreCase(status)) {
                    continue;
                }

                formsProcessed++;
                String formName = trim(String.valueOf(form.get("name")));
                Map<String, Object> perForm = syncFacebookFormLeads(formId, formName, accessToken, leadPageSize);
                leadsFetched += toInt(perForm.get("fetched"));
                imported += toInt(perForm.get("imported"));
                merged += toInt(perForm.get("merged"));
                skipped += toInt(perForm.get("skipped"));
                List<String> formErrors = (List<String>) perForm.get("errors");
                if (formErrors != null && !formErrors.isEmpty()) {
                    errors.addAll(formErrors);
                }
            }

            if (requestedFormId != null && !requestedFormId.isBlank() && formsProcessed > 0) {
                break;
            }
            formsUrl = extractPagingNext(formsResponse);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("message", "Facebook lead sync completed.");
        result.put("pageId", pageId);
        result.put("formId", requestedFormId != null ? requestedFormId : "");
        result.put("formsProcessed", formsProcessed);
        result.put("fetched", leadsFetched);
        result.put("imported", imported);
        result.put("merged", merged);
        result.put("skipped", skipped);
        result.put("errors", errors.size());
        if (!errors.isEmpty()) {
            result.put("errorDetails", errors.size() > 50 ? errors.subList(0, 50) : errors);
        }
        return result;
    }

    public Map<String, Object> testPublicGoogleSheetAccess(Map<String, String> config) {
        String csv = fetchPublicSheetCsv(config);
        List<List<String>> rows = parseCsv(csv);
        if (rows.isEmpty()) {
            throw new IllegalStateException("Sheet is reachable but empty.");
        }

        List<String> headers = rows.get(0);
        Map<String, Integer> headerIndex = buildHeaderIndex(headers);
        boolean hasName = headerIndex.containsKey("name");
        boolean hasEmail = headerIndex.containsKey("email");
        if (!hasName && !hasEmail) {
            throw new IllegalStateException("Header row must include at least Name or Email columns.");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("message", "Sheet access test passed.");
        result.put("rowsDetected", Math.max(0, rows.size() - 1));
        result.put("headers", headers);
        return result;
    }

    public byte[] export(String format, String status) {
        List<Lead> leads;
        if (status != null && !status.isBlank()) {
            leads = leadRepository.findByTenantIdAndDeletedFalseAndStatus(
                tenantId(),
                Lead.LeadStatus.valueOf(status.toUpperCase(Locale.ROOT))
            );
        } else {
            leads = leadRepository.findByTenantIdAndDeletedFalse(tenantId());
        }

        String normalized = format == null ? "csv" : format.trim().toLowerCase(Locale.ROOT);
        if ("xlsx".equals(normalized)) return exportAsXlsx(leads);
        if ("pdf".equals(normalized)) return exportAsPdf(leads);
        return exportAsCsv(leads);
    }

    @CacheEvict(value = "leads-list", allEntries = true)
    public Map<String, Object> scoreWithAI(String id) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);

        int scoreValue = calculateLeadScoreValue(lead);
        Lead.LeadScore score = mapScore(scoreValue);
        String nextAction = suggestNextAction(lead, score, scoreValue);

        lead.setAiScoreValue(scoreValue);
        lead.setScore(score);
        lead.setAiNextAction(nextAction);
        leadChangeAuditService.save(lead);

        return Map.of(
            "leadId", id,
            "score", score.name(),
            "scoreValue", scoreValue,
            "nextAction", nextAction,
            "message", "Lead scored successfully"
        );
    }

    @Caching(evict = {
        @CacheEvict(value = "dashboard-summary", allEntries = true),
        @CacheEvict(value = "dashboard-funnel", allEntries = true),
        @CacheEvict(value = "dashboard-employees", allEntries = true),
        @CacheEvict(value = "dashboard-sources", allEntries = true),
        @CacheEvict(value = "dashboard-activities", allEntries = true),
        @CacheEvict(value = "dashboard-trend", allEntries = true),
        @CacheEvict(value = "dashboard-widgets", allEntries = true),
        @CacheEvict(value = "dashboard-overview", allEntries = true),
        @CacheEvict(value = "leads-list", allEntries = true),
        @CacheEvict(value = "pipeline-board", allEntries = true)
    })
    public Map<String, Object> convertToCustomer(String id, Map<String, Object> options) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);

        Customer customer = customerRepository
            .findByEmailAndTenantIdAndDeletedFalse(lead.getEmail(), tenantId())
            .orElseGet(() -> {
                Customer.CustomerBuilder builder = Customer.builder()
                    .name(lead.getName())
                    .email(lead.getEmail())
                    .phone(lead.getPhone())
                    .company(lead.getCompany())
                    .website(lead.getWebsite())
                    .industry(lead.getService())
                    .primaryContact(lead.getName())
                    .status(Customer.CustomerStatus.ACTIVE)
                    .notes(lead.getNotes());

                if (lead.getAssignedTo() != null) {
                    builder.accountManager(lead.getAssignedTo());
                }

                Customer created = builder.build();
                created.setTenantId(tenantId());
                return customerRepository.save(created);
            });

        Deal deal = dealRepository
            .findByLead_IdAndTenantIdAndDeletedFalse(lead.getId(), tenantId())
            .orElseGet(() -> {
                String title = (lead.getCompany() != null && !lead.getCompany().isBlank())
                    ? lead.getCompany() + " Opportunity"
                    : lead.getName() + " Opportunity";

                Deal.DealBuilder builder = Deal.builder()
                    .title(title)
                    .description("Auto-created from converted lead")
                    .stage(Deal.DealStage.WON)
                    .priority(Deal.DealPriority.MEDIUM)
                    .dealValue(lead.getDealValue())
                    .pipelineId(1L)
                    .lead(lead)
                    .notes(lead.getNotes());

                if (lead.getAssignedTo() != null) {
                    builder.owner(lead.getAssignedTo());
                }

                Deal created = builder.build();
                created.setTenantId(tenantId());
                return dealRepository.save(created);
            });

        LocalDateTime convertedAt = LocalDateTime.now();
        lead.setStatus(Lead.LeadStatus.WON);
        lead.setConvertedAt(convertedAt);
        lead.setLastContactedAt(LocalDateTime.now());
        if (lead.getRevenueValue() == null) {
            lead.setRevenueValue(lead.getDealValue());
        }
        leadChangeAuditService.save(lead);

        try {
            notificationService.notifyActiveUsers(
                tenantId(),
                com.nexacrm.model.Notification.NotificationType.DEAL,
                "Lead Converted",
                "Lead " + (lead.getName() != null ? lead.getName() : "Unknown lead") +
                    " converted into deal " + deal.getTitle(),
                "/pipeline",
                "deal",
                deal.getId(),
                null
            );
        } catch (Exception ex) {
            log.warn("Failed to publish lead conversion notification for lead {}: {}", lead.getId(), ex.getMessage());
        }

        return Map.of(
            "message", "Lead converted to customer",
            "leadId", lead.getId(),
            "customerId", customer.getId(),
            "dealId", deal.getId(),
            "convertedAt", convertedAt,
            "lead", toDTO(lead)
        );
    }

    @CacheEvict(value = "leads-list", allEntries = true)
    public Map<String, Object> callLeadNow(String id, String script) {
        return callLeadNow(id, script, null, null, null);
    }

    @CacheEvict(value = "leads-list", allEntries = true)
    public Map<String, Object> callLeadNow(String id, String script, String setup, String fromNumber, String toNumber) {
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + id));
        ensureLeadVisible(lead);

        String phone = (toNumber != null && !toNumber.isBlank()) ? toNumber.trim() : (lead.getPhone() == null ? "" : lead.getPhone().trim());
        if (phone.isBlank()) {
            throw new IllegalStateException("Lead phone number is missing.");
        }

        String callScript = script == null ? "" : script.trim();
        if (callScript.isBlank()) {
            String leadName = lead.getName() == null ? "" : lead.getName().trim();
            String service = lead.getService() == null ? "" : lead.getService().trim();
            String serviceSnippet = service.isBlank() ? "" : " for " + service;
            callScript = "Hi " + (leadName.isBlank() ? "there" : leadName)
                + ", this is NexaCRM calling regarding your enquiry"
                + serviceSnippet
                + ". Is this a good time to talk?";
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("leadId", lead.getId());
        metadata.put("leadName", lead.getName() != null ? lead.getName() : "");
        metadata.put("company", lead.getCompany() != null ? lead.getCompany() : "");
        metadata.put("service", lead.getService() != null ? lead.getService() : "");
        metadata.put("source", lead.getSource() != null ? lead.getSource().name() : "OTHER");
        if (setup != null && !setup.isBlank()) {
            metadata.put("setup", setup.trim());
            metadata.put("provider", setup.trim());
        }
        if (fromNumber != null && !fromNumber.isBlank()) {
            metadata.put("fromNumber", fromNumber.trim());
        }
        if (toNumber != null && !toNumber.isBlank()) {
            metadata.put("toNumber", toNumber.trim());
        }

        communicationService.sendLeadVoiceCall(
            lead.getId(),
            lead.getName(),
            phone,
            callScript,
            "manual_lead_call",
            metadata
        );
        lead.setLastContactedAt(LocalDateTime.now());
        leadChangeAuditService.save(lead);

        return Map.of(
            "message", "Call queued successfully",
            "leadId", lead.getId(),
            "phone", phone,
            "setup", setup != null ? setup : "",
            "fromNumber", fromNumber != null ? fromNumber : ""
        );
    }

    // ── Facebook Lead Ads ─────────────────────────────────────────

    @Async
    public void processFacebookLeadsWebhookAsync(String rawBody) {
        try {
            Map<String, Object> payload = objectMapper.readValue(rawBody, Map.class);
            List<Map<String, Object>> entries = (List<Map<String, Object>>) payload.get("entry");
            if (entries == null) return;

            for (Map<String, Object> entry : entries) {
                List<Map<String, Object>> changes = (List<Map<String, Object>>) entry.get("changes");
                if (changes == null) continue;
                for (Map<String, Object> change : changes) {
                    if (!"leadgen".equals(change.get("field"))) continue;
                    Map<String, Object> value = (Map<String, Object>) change.get("value");
                    if (value == null) continue;
                    String leadgenId = String.valueOf(value.get("leadgen_id"));
                    String adId     = value.get("ad_id")   != null ? String.valueOf(value.get("ad_id"))   : null;
                    String formId   = value.get("form_id") != null ? String.valueOf(value.get("form_id")) : null;
                    fetchAndSaveLead(leadgenId, adId, formId);
                }
            }
        } catch (Exception e) {
            log.error("Error processing Facebook Lead Ads webhook", e);
        }
    }

    @SuppressWarnings("unchecked")
    private void fetchAndSaveLead(String leadgenId, String adId, String formId) {
        try {
            // Idempotency: skip if we already processed this Facebook lead
            if (leadRepository.findByFacebookLeadIdAndTenantIdAndDeletedFalse(leadgenId, tenantId()).isPresent()) {
                log.info("Facebook lead already exists, skipping: leadgen_id={}", leadgenId);
                return;
            }
            if (isDeletedExternalLeadSuppressed(META_ADS_SOURCE, leadgenId)) {
                log.info("Facebook lead was deleted from CRM, skipping re-import: leadgen_id={}", leadgenId);
                return;
            }

            String accessToken = resolveFacebookLeadAccessToken();
            if (accessToken.isBlank()) {
                log.error("Facebook lead fetch failed: missing access token (integration + env both empty)");
                return;
            }

            String url = "https://graph.facebook.com/" + graphApiVersion + "/" + leadgenId
                + "?access_token=" + accessToken
                + "&fields=field_data,created_time,ad_id,form_id,campaign_id";

            Map<String, Object> response = restTemplate.getForObject(URI.create(url), Map.class);
            if (response == null) {
                log.warn("Facebook Graph API returned null for leadgen_id={}", leadgenId);
                return;
            }

            // Prefer IDs from the Graph API response over the webhook payload (more authoritative)
            String resolvedFormId = response.get("form_id") != null
                ? String.valueOf(response.get("form_id")) : formId;
            String resolvedAdId   = response.get("ad_id") != null
                ? String.valueOf(response.get("ad_id"))   : adId;

            List<Map<String, Object>> fieldData = (List<Map<String, Object>>) response.get("field_data");
            String name        = extractFieldValue(fieldData, "full_name", "first_name");
            String email       = extractFieldValue(fieldData, "email");
            String phone       = extractFieldValue(fieldData, "phone_number", "phone", "mobile_number", "mobile", "whatsapp_number");
            String company     = extractFieldValue(fieldData, "company_name", "company");
            String designation = extractFieldValue(fieldData, "job_title", "work_job_title");

            if (name == null || name.isBlank()) name = "Facebook Lead " + leadgenId;
            if (email == null || email.isBlank()) email = leadgenId + "@facebook-lead.local";

            LeadDTO dto = LeadDTO.builder()
                .name(name)
                .email(email)
                .phone(phone)
                .company(company)
                .designation(designation)
                .source(Lead.LeadSource.META_ADS)
                .status(Lead.LeadStatus.NEW)
                .score(Lead.LeadScore.COLD)
                .priority(Lead.LeadPriority.MEDIUM)
                .utmSource("facebook")
                .utmMedium("lead_ad")
                .utmCampaign(resolvedAdId)
                .facebookLeadId(leadgenId)
                .facebookFormId(resolvedFormId)
                .facebookAdId(resolvedAdId)
                .notes(buildFacebookWebhookNotes(resolvedFormId, resolvedAdId, response))
                .build();

            create(dto);
            log.info("Facebook lead saved: leadgen_id={}, name={}, email={}", leadgenId, name, email);
        } catch (Exception e) {
            log.error("Failed to fetch/save Facebook lead for leadgen_id={}", leadgenId, e);
        }
    }

    private String resolveFacebookLeadAccessToken() {
        String integrationToken = trim(integrationService.getConfig("facebook").get("accessToken"));
        if (integrationToken != null && !integrationToken.isBlank()) {
            log.info("Facebook token source: integration_configs DB ({}...{})",
                safePrefix(integrationToken, 6), safeSuffix(integrationToken, 4));
            return integrationToken;
        }
        String envToken = trim(pageAccessToken);
        if (envToken != null && !envToken.isBlank()) {
            log.info("Facebook token source: META_PAGE_ACCESS_TOKEN env var ({}...{})",
                safePrefix(envToken, 6), safeSuffix(envToken, 4));
        }
        return envToken;
    }

    private static String safePrefix(String s, int n) {
        return s == null || s.length() < n ? "?" : s.substring(0, n);
    }

    private static String safeSuffix(String s, int n) {
        return s == null || s.length() < n ? "?" : s.substring(s.length() - n);
    }

    @SuppressWarnings("unchecked")
    private String resolveFacebookLeadAccessTokenForPage(String pageId, String configuredToken) {
        String token = trim(configuredToken);
        if (token == null || token.isBlank()) {
            token = resolveFacebookLeadAccessToken();
        }
        if (token == null || token.isBlank()) {
            return token;
        }

        String discoveredPageToken = null;
        try {
            String meAccountsUrl = "https://graph.facebook.com/" + graphApiVersion
                + "/me/accounts?fields=id,access_token&limit=200&access_token=" + token;

            Map<String, Object> meAccounts = restTemplate.getForObject(URI.create(meAccountsUrl), Map.class);
            List<Map<String, Object>> pages = meAccounts != null && meAccounts.get("data") instanceof List<?>
                ? (List<Map<String, Object>>) meAccounts.get("data")
                : List.of();

            for (Map<String, Object> page : pages) {
                String id = trim(String.valueOf(page.get("id")));
                if (pageId != null && pageId.equals(id)) {
                    discoveredPageToken = trim(String.valueOf(page.get("access_token")));
                    break;
                }
            }
        } catch (Exception ex) {
            log.debug("Facebook token discovery via /me/accounts skipped: {}", ex.getMessage());
        }

        if (discoveredPageToken != null && !discoveredPageToken.isBlank()) {
            if (!discoveredPageToken.equals(token)) {
                log.info("Resolved Facebook Page Access Token from /me/accounts for pageId={}", pageId);
            }
            return discoveredPageToken;
        }
        return token;
    }

    private boolean isFacebookPageAccessTokenRequiredError(RestClientResponseException ex) {
        String body = ex.getResponseBodyAsString();
        String normalized = body == null ? "" : body.toLowerCase(Locale.ROOT);
        return normalized.contains("code\":190")
            && normalized.contains("must be called with a page access token");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> syncFacebookFormLeads(String formId, String formName, String accessToken, int leadPageSize) {
        int fetched = 0;
        int imported = 0;
        int merged = 0;
        int skipped = 0;
        List<String> errors = new ArrayList<>();

        String leadsUrl = "https://graph.facebook.com/" + graphApiVersion + "/" + formId
            + "/leads?fields=id,created_time,ad_id,form_id,campaign_name,field_data"
            + "&limit=" + leadPageSize + "&access_token=" + accessToken;

        while (leadsUrl != null && !leadsUrl.isBlank()) {
            Map<String, Object> leadsResponse;
            try {
                leadsResponse = restTemplate.getForObject(URI.create(leadsUrl), Map.class);
            } catch (Exception ex) {
                errors.add("Form " + formId + ": fetch failed - " + ex.getMessage());
                break;
            }

            List<Map<String, Object>> leads = leadsResponse != null && leadsResponse.get("data") instanceof List<?>
                ? (List<Map<String, Object>>) leadsResponse.get("data")
                : List.of();

            for (Map<String, Object> rawLead : leads) {
                fetched++;
                String leadgenId = trim(String.valueOf(rawLead.get("id")));
                if (leadgenId == null || leadgenId.isBlank()) {
                    skipped++;
                    continue;
                }
                if (isDeletedExternalLeadSuppressed(META_ADS_SOURCE, leadgenId)) {
                    log.info("Facebook lead was deleted from CRM, skipping sync import: leadgen_id={}", leadgenId);
                    skipped++;
                    continue;
                }
                Optional<Lead> existingByFbId = leadRepository.findByFacebookLeadIdAndTenantIdAndDeletedFalse(leadgenId, tenantId());
                if (existingByFbId.isPresent()) {
                    // Backfill Facebook lead details that may be missing from a previous sync.
                    Lead ex = existingByFbId.get();
                    boolean changed = false;
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> fd = rawLead.get("field_data") instanceof List<?>
                        ? (List<Map<String, Object>>) rawLead.get("field_data") : List.of();

                    if (ex.getPhone() == null || ex.getPhone().isBlank()) {
                        String ph = extractFieldValue(fd, "phone_number", "phone", "mobile_number", "mobile", "whatsapp_number");
                        if (ph != null && !ph.isBlank()) {
                            ex.setPhone(normalizePhone(ph));
                            changed = true;
                        }
                    }

                    if (ex.getNotes() == null || ex.getNotes().isBlank()) {
                        String adId = trim(String.valueOf(rawLead.get("ad_id")));
                        String responseFormId = trim(String.valueOf(rawLead.get("form_id")));
                        String resolvedFormId = responseFormId != null && !responseFormId.isBlank() ? responseFormId : formId;
                        Map<String, Object> enrichedPayload = new HashMap<>(rawLead);
                        enrichedPayload.putIfAbsent("form_name", formName);
                        ex.setNotes(buildFacebookWebhookNotes(resolvedFormId, adId, enrichedPayload));
                        changed = true;
                    }

                    if (changed) {
                        leadChangeAuditService.save(ex);
                    }
                    skipped++;
                    continue;
                }

                try {
                    List<Map<String, Object>> fieldData = rawLead.get("field_data") instanceof List<?>
                        ? (List<Map<String, Object>>) rawLead.get("field_data")
                        : List.of();

                    String name = extractFieldValue(fieldData, "full_name", "first_name");
                    String email = extractFieldValue(fieldData, "email");
                    String phone = extractFieldValue(fieldData, "phone_number", "phone", "mobile_number", "mobile", "whatsapp_number");
                    String company = extractFieldValue(fieldData, "company_name", "company");
                    String designation = extractFieldValue(fieldData, "job_title", "work_job_title");
                    String service = extractFieldValue(fieldData, "service", "service_name");
                    String specialization = extractFieldValue(fieldData, "specialization", "subservice", "sub_service");
                    String campaignName = trim(String.valueOf(rawLead.get("campaign_name")));
                    String adId = trim(String.valueOf(rawLead.get("ad_id")));
                    String responseFormId = trim(String.valueOf(rawLead.get("form_id")));

                    if (name == null || name.isBlank()) {
                        name = "Facebook Lead " + leadgenId;
                    }
                    if (email == null || email.isBlank()) {
                        email = leadgenId + "@facebook-lead.local";
                    }

                    Map<String, Object> enrichedPayload = new HashMap<>(rawLead);
                    enrichedPayload.putIfAbsent("form_name", formName);

                    LeadDTO dto = LeadDTO.builder()
                        .name(name)
                        .email(email)
                        .phone(phone)
                        .company(company)
                        .designation(designation)
                        .service(service)
                        .specialization(specialization)
                        .source(Lead.LeadSource.META_ADS)
                        .status(Lead.LeadStatus.NEW)
                        .score(Lead.LeadScore.COLD)
                        .priority(Lead.LeadPriority.MEDIUM)
                        .utmSource("facebook")
                        .utmMedium("lead_ads_sync")
                        .utmCampaign(campaignName != null && !campaignName.isBlank() ? campaignName : adId)
                        .facebookLeadId(leadgenId)
                        .facebookFormId(responseFormId != null && !responseFormId.isBlank() ? responseFormId : formId)
                        .facebookAdId(adId)
                        .notes(buildFacebookWebhookNotes(
                            responseFormId != null && !responseFormId.isBlank() ? responseFormId : formId,
                            adId,
                            enrichedPayload
                        ))
                        .build();

                    create(dto);
                    imported++;
                } catch (Exception ex) {
                    if (isDuplicateEmailError(ex)) {
                        if (mergeIntoExistingLeadByEmail(rawLead, formId, formName)) {
                            merged++;
                        } else {
                            skipped++;
                        }
                        continue;
                    }
                    errors.add("Lead " + leadgenId + ": " + ex.getMessage());
                }
            }

            leadsUrl = extractPagingNext(leadsResponse);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fetched", fetched);
        result.put("imported", imported);
        result.put("merged", merged);
        result.put("skipped", skipped);
        result.put("errors", errors);
        return result;
    }

    private String buildFacebookWebhookNotes(String formId, String adId, Map<String, Object> graphResponse) {
        StringBuilder sb = new StringBuilder("Facebook Lead Ad | Form: ");
        sb.append(formId);
        if (adId != null && !adId.isBlank()) {
            sb.append(" | Ad: ").append(adId);
        }
        sb.append("\n\nRaw Payload:\n");
        try {
            sb.append(objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(graphResponse));
        } catch (Exception e) {
            sb.append(String.valueOf(graphResponse));
        }
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private boolean mergeIntoExistingLeadByEmail(Map<String, Object> rawLead, String fallbackFormId, String fallbackFormName) {
        try {
            List<Map<String, Object>> fieldData = rawLead.get("field_data") instanceof List<?>
                ? (List<Map<String, Object>>) rawLead.get("field_data")
                : List.of();
            String email = extractFieldValue(fieldData, "email");
            if (email == null || email.isBlank()) return false;

            String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
            Optional<Lead> existingOpt = leadRepository.findByEmailAndTenantIdAndDeletedFalse(normalizedEmail, tenantId());
            if (existingOpt.isEmpty()) return false;

            Lead existing = existingOpt.get();
            String leadgenId = trim(String.valueOf(rawLead.get("id")));
            String adId = trim(String.valueOf(rawLead.get("ad_id")));
            String responseFormId = trim(String.valueOf(rawLead.get("form_id")));
            String formId = responseFormId != null && !responseFormId.isBlank() ? responseFormId : fallbackFormId;

            Map<String, Object> enrichedPayload = new HashMap<>(rawLead);
            enrichedPayload.putIfAbsent("form_name", fallbackFormName);

            String mergeNote = "\n\n[Meta Sync Merge]\n"
                + buildFacebookWebhookNotes(formId, adId, enrichedPayload);
            existing.setNotes(appendNote(existing.getNotes(), mergeNote));
            if (existing.getFacebookLeadId() == null || existing.getFacebookLeadId().isBlank()) {
                existing.setFacebookLeadId(leadgenId);
            }
            if (existing.getFacebookFormId() == null || existing.getFacebookFormId().isBlank()) {
                existing.setFacebookFormId(formId);
            }
            if (existing.getFacebookAdId() == null || existing.getFacebookAdId().isBlank()) {
                existing.setFacebookAdId(adId);
            }
            if (existing.getSource() == null || existing.getSource() == Lead.LeadSource.OTHER) {
                existing.setSource(Lead.LeadSource.META_ADS);
            }
            // Backfill phone, company, designation if missing
            String phone = extractFieldValue(fieldData, "phone_number", "phone", "mobile_number", "mobile", "whatsapp_number");
            if (phone != null && !phone.isBlank() && (existing.getPhone() == null || existing.getPhone().isBlank())) {
                existing.setPhone(normalizePhone(phone));
            }
            String company = extractFieldValue(fieldData, "company_name", "company");
            if (company != null && !company.isBlank() && (existing.getCompany() == null || existing.getCompany().isBlank())) {
                existing.setCompany(company);
            }
            String designation = extractFieldValue(fieldData, "job_title", "work_job_title");
            if (designation != null && !designation.isBlank() && (existing.getDesignation() == null || existing.getDesignation().isBlank())) {
                existing.setDesignation(designation);
            }
            leadChangeAuditService.save(existing);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isDuplicateEmailError(Exception ex) {
        String message = ex.getMessage();
        return message != null && message.toLowerCase(Locale.ROOT).contains("already exists");
    }

    private boolean isDeletedExternalLeadSuppressed(String source, String externalId) {
        String normalizedSource = trim(source);
        String normalizedExternalId = trim(externalId);
        if (normalizedSource == null || normalizedSource.isBlank()
            || normalizedExternalId == null || normalizedExternalId.isBlank()) {
            return false;
        }

        Query query = Query.query(Criteria.where("tenant_id").is(tenantId())
            .and("source").is(normalizedSource)
            .and("external_id").is(normalizedExternalId)
            .and("deleted").ne(true));
        return mongoTemplate.exists(query, LEAD_IMPORT_SUPPRESSIONS_COLLECTION);
    }

    private String appendNote(String existing, String addition) {
        String base = existing == null ? "" : existing.trim();
        String extra = addition == null ? "" : addition.trim();
        if (extra.isBlank()) return base;
        if (base.isBlank()) return extra;
        return base + "\n" + extra;
    }

    private void validateLostReason(Lead lead) {
        if (lead == null || lead.getStatus() != Lead.LeadStatus.LOST) {
            return;
        }
        if (lead.getLostReason() == null || lead.getLostReason().isBlank()) {
            throw new IllegalStateException("Lost reason is required when lead status is LOST");
        }
    }

    private boolean matchesDuplicateCandidate(Lead lead, String normalizedEmail, String normalizedPhone) {
        if (lead == null) return false;
        String leadEmail = normalizeEmail(lead.getEmail());
        String leadPhone = normalizePhone(lead.getPhone());
        boolean emailMatch = normalizedEmail != null && !normalizedEmail.isBlank() && normalizedEmail.equals(leadEmail);
        boolean phoneMatch = normalizedPhone != null && !normalizedPhone.isBlank() && normalizedPhone.equals(leadPhone);
        return emailMatch || phoneMatch;
    }

    private void mergeLeadFields(Lead primary, Lead duplicate) {
        if (primary == null || duplicate == null) return;
        if (isBlank(primary.getCompany())) primary.setCompany(duplicate.getCompany());
        if (isBlank(primary.getWebsite())) primary.setWebsite(duplicate.getWebsite());
        if (isBlank(primary.getDesignation())) primary.setDesignation(duplicate.getDesignation());
        if (isBlank(primary.getService())) primary.setService(duplicate.getService());
        if (isBlank(primary.getSpecialization())) primary.setSpecialization(duplicate.getSpecialization());
        if ((primary.getSource() == null || primary.getSource() == Lead.LeadSource.OTHER) && duplicate.getSource() != null) primary.setSource(duplicate.getSource());
        if ((primary.getStatus() == null || primary.getStatus() == Lead.LeadStatus.NEW) && duplicate.getStatus() != null) primary.setStatus(duplicate.getStatus());
        if ((primary.getScore() == null || primary.getScore() == Lead.LeadScore.COLD) && duplicate.getScore() != null) primary.setScore(duplicate.getScore());
        if (primary.getPriority() == null && duplicate.getPriority() != null) primary.setPriority(duplicate.getPriority());
        if (primary.getDealValue() == null && duplicate.getDealValue() != null) primary.setDealValue(duplicate.getDealValue());
        if (primary.getUtmSource() == null) primary.setUtmSource(duplicate.getUtmSource());
        if (primary.getUtmMedium() == null) primary.setUtmMedium(duplicate.getUtmMedium());
        if (primary.getUtmCampaign() == null) primary.setUtmCampaign(duplicate.getUtmCampaign());
        if (primary.getAiScoreValue() == null) primary.setAiScoreValue(duplicate.getAiScoreValue());
        if (isBlank(primary.getAiNextAction())) primary.setAiNextAction(duplicate.getAiNextAction());
        if (isBlank(primary.getNotes())) primary.setNotes(duplicate.getNotes());
        if (primary.getLastContactedAt() == null) primary.setLastContactedAt(duplicate.getLastContactedAt());
        if (primary.getConvertedAt() == null) primary.setConvertedAt(duplicate.getConvertedAt());
        if (isBlank(primary.getLostReason())) primary.setLostReason(duplicate.getLostReason());
        if (primary.getFollowUpDate() == null) primary.setFollowUpDate(duplicate.getFollowUpDate());
        if (primary.getRevenueValue() == null) primary.setRevenueValue(duplicate.getRevenueValue());
        if (isBlank(primary.getFacebookLeadId())) primary.setFacebookLeadId(duplicate.getFacebookLeadId());
        if (isBlank(primary.getFacebookFormId())) primary.setFacebookFormId(duplicate.getFacebookFormId());
        if (isBlank(primary.getFacebookAdId())) primary.setFacebookAdId(duplicate.getFacebookAdId());
        if (primary.getAssignedTo() == null) primary.setAssignedTo(duplicate.getAssignedTo());
    }

    private List<String> mergeActivityLogs(List<String> primaryLogs, List<String> duplicateLogs) {
        List<String> merged = new ArrayList<>();
        if (duplicateLogs != null) merged.addAll(duplicateLogs);
        if (primaryLogs != null) merged.addAll(primaryLogs);
        return merged.stream().distinct().limit(25).collect(Collectors.toList());
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    @SuppressWarnings("unchecked")
    private String extractPagingNext(Map<String, Object> response) {
        if (response == null) return null;
        Object pagingObj = response.get("paging");
        if (!(pagingObj instanceof Map<?, ?> paging)) return null;
        Object next = ((Map<String, Object>) paging).get("next");
        return next == null ? null : String.valueOf(next);
    }

    private int parsePositiveInt(String value, int defaultValue) {
        try {
            int parsed = Integer.parseInt(trim(value));
            return parsed > 0 ? parsed : defaultValue;
        } catch (Exception e) {
            return defaultValue;
        }
    }

    private boolean parseBoolean(String value, boolean defaultValue) {
        String v = trim(value);
        if (v == null || v.isBlank()) return defaultValue;
        return "true".equalsIgnoreCase(v) || "1".equals(v) || "yes".equalsIgnoreCase(v);
    }

    private int toInt(Object value) {
        if (value instanceof Number n) return n.intValue();
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception e) {
            return 0;
        }
    }

    private String extractFieldValue(List<Map<String, Object>> fieldData, String... fieldNames) {
        if (fieldData == null) return null;
        for (String fieldName : fieldNames) {
            String normalizedFieldName = normalizeFacebookFieldName(fieldName);
            String value = fieldData.stream()
                .filter(f -> {
                    String name = normalizeFacebookFieldName(f.get("name"));
                    return normalizedFieldName.equals(name);
                })
                .findFirst()
                .map(f -> firstFacebookFieldValue(f.get("values")))
                .orElse(null);
            if (value != null && !value.isBlank()) return value;
        }
        return null;
    }

    private String normalizeFacebookFieldName(Object value) {
        return value == null ? "" : value.toString().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private String firstFacebookFieldValue(Object values) {
        if (values == null) return null;
        if (values instanceof Iterable<?> iterable) {
            for (Object value : iterable) {
                String trimmed = trim(value == null ? null : String.valueOf(value));
                if (trimmed != null && !trimmed.isBlank()) return trimmed;
            }
            return null;
        }
        if (values.getClass().isArray()) {
            int length = java.lang.reflect.Array.getLength(values);
            for (int i = 0; i < length; i++) {
                Object value = java.lang.reflect.Array.get(values, i);
                String trimmed = trim(value == null ? null : String.valueOf(value));
                if (trimmed != null && !trimmed.isBlank()) return trimmed;
            }
            return null;
        }
        return trim(String.valueOf(values));
    }

    private Map<String, Integer> buildHeaderIndex(List<String> headers) {
        Map<String, Integer> index = new LinkedHashMap<>();
        for (int i = 0; i < headers.size(); i++) {
            String key = normalizeKey(headers.get(i));
            if (!key.isBlank()) {
                index.putIfAbsent(key, i);
            }
        }
        return index;
    }

    private String readCell(List<String> row, Map<String, Integer> headerIndex, String... keys) {
        for (String key : keys) {
            Integer idx = headerIndex.get(normalizeKey(key));
            if (idx == null || idx < 0 || idx >= row.size()) continue;
            String value = trim(row.get(idx));
            if (value != null && !value.isBlank()) return value;
        }
        return "";
    }

    private String normalizeKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replace(" ", "");
    }

    private String trim(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? "" : trimmed;
    }

    private String mergeNotes(String subject, String message, String date) {
        StringBuilder sb = new StringBuilder("Imported from Google Sheet");
        if (subject != null && !subject.isBlank()) sb.append(" | Subject: ").append(subject.trim());
        if (message != null && !message.isBlank()) sb.append(" | Message: ").append(message.trim());
        if (date != null && !date.isBlank()) sb.append(" | Date: ").append(date.trim());
        return sb.toString();
    }

    private List<String> parseTags(String tags) {
        if (tags == null || tags.isBlank()) return null;
        List<String> values = Arrays.stream(tags.split(","))
            .map(String::trim)
            .filter(s -> !s.isBlank())
            .toList();
        return values.isEmpty() ? null : values;
    }

    private BigDecimal parseAmount(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String normalized = raw.replace(",", "").replace("₹", "").trim();
        if (normalized.isBlank()) return null;
        return new BigDecimal(normalized);
    }

    private Lead.LeadSource parseSource(String source) {
        if (source == null || source.isBlank()) return Lead.LeadSource.OTHER;
        String s = source.trim().toUpperCase(Locale.ROOT).replace(" ", "_");
        if ("GOOGLEADS".equals(s)) s = "GOOGLE_ADS";
        if ("METAADS".equals(s)) s = "META_ADS";
        try {
            return Lead.LeadSource.valueOf(s);
        } catch (IllegalArgumentException ex) {
            return Lead.LeadSource.OTHER;
        }
    }

    private Lead.LeadScore parseScore(String score) {
        if (score == null || score.isBlank()) return Lead.LeadScore.COLD;
        try {
            return Lead.LeadScore.valueOf(score.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return Lead.LeadScore.COLD;
        }
    }

    private Lead.LeadStatus parseStatus(String status) {
        if (status == null || status.isBlank()) return Lead.LeadStatus.NEW;
        try {
            return Lead.LeadStatus.valueOf(status.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return Lead.LeadStatus.NEW;
        }
    }

    private String normalizeEmail(String email) {
        if (email == null) return null;
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? null : normalized;
    }

    private String normalizePhone(String phone) {
        if (phone == null) return null;
        String normalized = phone.trim();
        return normalized.isBlank() ? null : normalized;
    }

    private void ensureLeadVisible(Lead lead) {
        if (!canCurrentUserAccess(lead)) {
            throw new ResourceNotFoundException("Lead not found: " + lead.getId());
        }
    }

    private boolean canCurrentUserAccess(Lead lead) {
        User current = currentUser();
        if (current == null || User.isAdminLike(current.getRole()) || current.getRole() == User.Role.MANAGER) {
            return true;
        }
        if (current.getId() == null || current.getId().isBlank() || lead == null) {
            return false;
        }
        return lead.getAssignedTo() != null && current.getId().equals(lead.getAssignedTo().getId());
    }

    private int calculateLeadScoreValue(Lead lead) {
        if (lead.getExpectedCloseTimeline() != null) {
            return switch (lead.getExpectedCloseTimeline()) {
                case DAYS_1_3 -> 90;
                case DAYS_7_10 -> 65;
                case DAYS_10_15_PLUS -> 30;
            };
        }

        int scoreValue = 10;

        if (lead.getEmail() != null && !lead.getEmail().isBlank()) scoreValue += 12;
        if (lead.getPhone() != null && !lead.getPhone().isBlank()) scoreValue += 10;
        if (lead.getCompany() != null && !lead.getCompany().isBlank()) scoreValue += 8;
        if (lead.getAssignedTo() != null) scoreValue += 6;

        if (lead.getSource() != null) {
            scoreValue += switch (lead.getSource()) {
                case REFERRAL -> 20;
                case LINKEDIN -> 15;
                case WEBSITE -> 12;
                case EMAIL -> 10;
                case GOOGLE_ADS, META_ADS -> 8;
                case WHATSAPP, FACEBOOK, INSTAGRAM -> 7;
                default -> 5;
            };
        }

        if (lead.getStatus() != null) {
            scoreValue += switch (lead.getStatus()) {
                case NEW -> 0;
                case CONTACTED -> 8;
                case QUALIFIED -> 18;
                case PROPOSAL -> 22;
                case NEGOTIATION -> 26;
                case WON -> 30;
                case LOST -> -25;
            };
        }

        if (lead.getPriority() != null) {
            scoreValue += switch (lead.getPriority()) {
                case HIGH -> 12;
                case MEDIUM -> 4;
                case LOW -> -4;
            };
        }

        if (lead.getDealValue() != null) {
            int valueBand = lead.getDealValue().compareTo(BigDecimal.valueOf(1_000_000)) >= 0 ? 20
                : lead.getDealValue().compareTo(BigDecimal.valueOf(300_000)) >= 0 ? 14
                : lead.getDealValue().compareTo(BigDecimal.valueOf(100_000)) >= 0 ? 8 : 3;
            scoreValue += valueBand;
        }

        if (lead.getLastContactedAt() != null) {
            long daysSinceContact = Math.max(0, Duration.between(lead.getLastContactedAt(), LocalDateTime.now()).toDays());
            if (daysSinceContact <= 2) scoreValue += 10;
            else if (daysSinceContact <= 7) scoreValue += 4;
            else if (daysSinceContact > 14) scoreValue -= 10;
        }

        return Math.max(0, Math.min(100, scoreValue));
    }

    private Lead.LeadScore mapScore(int scoreValue) {
        if (scoreValue >= 75) return Lead.LeadScore.HOT;
        if (scoreValue >= 45) return Lead.LeadScore.WARM;
        return Lead.LeadScore.COLD;
    }

    private String suggestNextAction(Lead lead, Lead.LeadScore score, int scoreValue) {
        if (lead.getStatus() == Lead.LeadStatus.LOST) {
            return "Review loss reason and schedule a re-engagement plan in 30 days.";
        }
        if (score == Lead.LeadScore.HOT) {
            return "Schedule a decision-maker call within 24 hours and push to negotiation.";
        }
        if (score == Lead.LeadScore.WARM) {
            return "Follow up with a personalized proposal and timeline this week.";
        }
        if (scoreValue < 30) {
            return "Run a discovery call to validate budget, authority, and timeline.";
        }
        return "Continue qualification and capture missing requirements.";
    }

    private List<List<String>> parseCsv(String csv) {
        List<List<String>> rows = new ArrayList<>();
        List<String> currentRow = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < csv.length(); i++) {
            char ch = csv.charAt(i);

            if (ch == '"') {
                if (inQuotes && i + 1 < csv.length() && csv.charAt(i + 1) == '"') {
                    cell.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch == ',' && !inQuotes) {
                currentRow.add(cell.toString());
                cell.setLength(0);
                continue;
            }

            if ((ch == '\n' || ch == '\r') && !inQuotes) {
                if (ch == '\r' && i + 1 < csv.length() && csv.charAt(i + 1) == '\n') i++;
                currentRow.add(cell.toString());
                cell.setLength(0);
                rows.add(currentRow);
                currentRow = new ArrayList<>();
                continue;
            }

            cell.append(ch);
        }

        if (!currentRow.isEmpty() || cell.length() > 0) {
            currentRow.add(cell.toString());
            rows.add(currentRow);
        }

        return rows;
    }

    private List<List<String>> parseExcel(MultipartFile file) throws IOException {
        List<List<String>> rows = new ArrayList<>();
        try (XSSFWorkbook workbook = new XSSFWorkbook(file.getInputStream())) {
            Sheet sheet = workbook.getNumberOfSheets() > 0 ? workbook.getSheetAt(0) : null;
            if (sheet == null) return rows;

            for (Row row : sheet) {
                int cellCount = Math.max(1, row.getLastCellNum());
                List<String> cells = new ArrayList<>();
                for (int i = 0; i < cellCount; i++) {
                    var cell = row.getCell(i);
                    cells.add(cell == null ? "" : cell.toString());
                }
                rows.add(cells);
            }
        }
        return rows;
    }

    private byte[] exportAsCsv(List<Lead> leads) {
        String[] headers = {
            "name","email","phone","company","service","specialization","source",
            "score","status","value","assignedTo","createdAt","updatedAt","notes","tags"
        };
        StringBuilder sb = new StringBuilder(String.join(",", headers)).append('\n');

        for (Lead lead : leads) {
            List<String> row = List.of(
                safe(lead.getName()),
                safe(lead.getEmail()),
                safe(lead.getPhone()),
                safe(lead.getCompany()),
                safe(lead.getService()),
                safe(lead.getSpecialization()),
                exportSourceLabel(lead),
                lead.getScore() != null ? lead.getScore().name() : "",
                lead.getStatus() != null ? lead.getStatus().name() : "",
                lead.getDealValue() != null ? lead.getDealValue().toPlainString() : "",
                lead.getAssignedTo() != null ? safe(lead.getAssignedTo().getName()) : "",
                lead.getCreatedAt() != null ? lead.getCreatedAt().toString() : "",
                lead.getUpdatedAt() != null ? lead.getUpdatedAt().toString() : "",
                safe(lead.getNotes()),
                safe(lead.getTags())
            );
            sb.append(row.stream().map(this::csvEscape).collect(Collectors.joining(","))).append('\n');
        }

        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    private byte[] exportAsXlsx(List<Lead> leads) {
        // ponytail: SXSSFWorkbook streams rows to disk instead of holding all in RAM — 10x faster
        try (org.apache.poi.xssf.streaming.SXSSFWorkbook workbook = new org.apache.poi.xssf.streaming.SXSSFWorkbook(100);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = workbook.createSheet("Leads");
            String[] headers = {
                "Name","Email","Phone","Company","Service","Specialization","Source",
                "Score","Status","Value","Assigned To","Created At","Updated At","Notes","Tags"
            };

            // Set column widths before streaming rows
            int[] charWidths = {20,30,16,20,20,20,12,10,12,12,20,22,22,30,20};
            for (int i = 0; i < headers.length; i++) {
                sheet.setColumnWidth(i, charWidths[i] * 256);
            }

            Row headerRow = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                headerRow.createCell(i).setCellValue(headers[i]);
            }

            int rowIdx = 1;
            for (Lead lead : leads) {
                Row row = sheet.createRow(rowIdx++);
                row.createCell(0).setCellValue(safe(lead.getName()));
                row.createCell(1).setCellValue(safe(lead.getEmail()));
                row.createCell(2).setCellValue(safe(lead.getPhone()));
                row.createCell(3).setCellValue(safe(lead.getCompany()));
                row.createCell(4).setCellValue(safe(lead.getService()));
                row.createCell(5).setCellValue(safe(lead.getSpecialization()));
                row.createCell(6).setCellValue(exportSourceLabel(lead));
                row.createCell(7).setCellValue(lead.getScore() != null ? lead.getScore().name() : "");
                row.createCell(8).setCellValue(lead.getStatus() != null ? lead.getStatus().name() : "");
                row.createCell(9).setCellValue(lead.getDealValue() != null ? lead.getDealValue().doubleValue() : 0d);
                row.createCell(10).setCellValue(lead.getAssignedTo() != null ? safe(lead.getAssignedTo().getName()) : "");
                row.createCell(11).setCellValue(lead.getCreatedAt() != null ? lead.getCreatedAt().toString() : "");
                row.createCell(12).setCellValue(lead.getUpdatedAt() != null ? lead.getUpdatedAt().toString() : "");
                row.createCell(13).setCellValue(safe(lead.getNotes()));
                row.createCell(14).setCellValue(safe(lead.getTags()));
            }

            workbook.write(out);
            workbook.dispose(); // clean up temp streaming files
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to export leads as XLSX", e);
        }
    }

    @SuppressWarnings("deprecation")
    private byte[] exportAsPdf(List<Lead> leads) {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            String[] headers = {"Name","Email","Phone","Company","Score","Status","Value","Source"};
            float[] colW = {90, 120, 80, 90, 45, 60, 55, 60};
            float pageW = PDRectangle.A4.getHeight(); // landscape
            float pageH = PDRectangle.A4.getWidth();
            float margin = 30;
            float rowH = 16;
            float headerH = 20;
            float yStart = pageH - margin;
            PDFont fontNormal = loadPdfFont(doc, false);
            PDFont fontBold = loadPdfFont(doc, true);
            if (fontNormal == null) fontNormal = PDType1Font.HELVETICA;
            if (fontBold == null) fontBold = fontNormal;
            float fontSize = 7.5f;

            int idx = 0;
            while (idx < leads.size() || idx == 0) {
                PDPage page = new PDPage(new PDRectangle(pageW, pageH));
                doc.addPage(page);
                PDPageContentStream cs = new PDPageContentStream(doc, page);
                float y = yStart;

                // title
                cs.beginText();
                cs.setFont(fontBold, 14);
                cs.newLineAtOffset(margin, y);
                cs.showText(pdfText(fontBold, "Leads Export — " + java.time.LocalDate.now()));
                cs.endText();
                y -= 28;

                // header row
                float x = margin;
                for (int i = 0; i < headers.length; i++) {
                    cs.beginText();
                    cs.setFont(fontBold, fontSize);
                    cs.newLineAtOffset(x, y);
                    cs.showText(pdfText(fontBold, headers[i]));
                    cs.endText();
                    x += colW[i];
                }
                y -= headerH;

                // data rows
                while (idx < leads.size() && y > margin + rowH) {
                    Lead lead = leads.get(idx);
                    x = margin;
                    String[] vals = {
                        safe(lead.getName()), safe(lead.getEmail()), safe(lead.getPhone()),
                        safe(lead.getCompany()),
                        lead.getScore() != null ? lead.getScore().name() : "",
                        lead.getStatus() != null ? lead.getStatus().name() : "",
                        lead.getDealValue() != null ? lead.getDealValue().toPlainString() : "0",
                        lead.getSource() != null ? lead.getSource().name() : ""
                    };
                    for (int i = 0; i < vals.length; i++) {
                        String v = pdfText(fontNormal, vals[i]);
                        if (v.length() > (int)(colW[i] / 4)) v = v.substring(0, (int)(colW[i] / 4)) + "…";
                        cs.beginText();
                        cs.setFont(fontNormal, fontSize);
                        cs.newLineAtOffset(x, y);
                        cs.showText(v);
                        cs.endText();
                        x += colW[i];
                    }
                    y -= rowH;
                    idx++;
                }
                cs.close();
                if (idx == 0) break; // empty list, one blank page
            }
            doc.save(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to export leads as PDF", e);
        }
    }

    private PDFont loadPdfFont(PDDocument doc, boolean bold) {
        String fileName = bold ? "NotoSansDevanagari-Bold.ttf" : "NotoSansDevanagari-Regular.ttf";
        List<Path> candidates = List.of(
            Path.of("/usr/share/fonts/truetype/noto", fileName),
            Path.of("/usr/share/fonts/opentype/noto", fileName),
            Path.of("/usr/local/share/fonts", fileName)
        );
        for (Path candidate : candidates) {
            if (!Files.isRegularFile(candidate)) continue;
            try {
                return PDType0Font.load(doc, candidate.toFile());
            } catch (IOException ex) {
                log.warn("Unable to load PDF font {}: {}", candidate, ex.getMessage());
            }
        }
        return null;
    }

    private String pdfText(PDFont font, String value) {
        if (value == null || value.isEmpty()) return "";
        StringBuilder safe = new StringBuilder(value.length());
        value.codePoints().forEach(codePoint -> {
            try {
                String glyph = new String(Character.toChars(codePoint));
                if (font.encode(glyph).length > 0) {
                    safe.appendCodePoint(codePoint);
                } else {
                    safe.append('?');
                }
            } catch (IOException | IllegalArgumentException ex) {
                safe.append('?');
            }
        });
        return safe.toString();
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    private String csvEscape(String value) {
        String v = sanitizeCsvValue(value);
        return "\"" + v.replace("\"", "\"\"") + "\"";
    }

    private String fetchPublicSheetCsv(Map<String, String> config) {
        String spreadsheetId = trim(config.get("spreadsheetId"));
        String sheetName = trim(config.get("sheetName"));
        String gid = trim(config.get("gid"));
        String publishedCsvUrl = trim(config.get("publishedCsvUrl"));

        if (spreadsheetId == null || spreadsheetId.isBlank()) {
            throw new IllegalStateException("spreadsheetId is required.");
        }
        if (sheetName == null || sheetName.isBlank()) {
            throw new IllegalStateException("sheetName is required.");
        }

        List<String> urlsToTry = new ArrayList<>();
        if (publishedCsvUrl != null && !publishedCsvUrl.isBlank()) {
            if (!isAllowedGoogleSheetsUrl(publishedCsvUrl, spreadsheetId)) {
                throw new IllegalStateException("publishedCsvUrl must point to the same Google Sheets document.");
            }
            urlsToTry.add(publishedCsvUrl);
        }
        if (gid != null && !gid.isBlank()) {
            urlsToTry.add("https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/export?format=csv&gid=" + gid);
        }
        urlsToTry.add("https://docs.google.com/spreadsheets/d/" + spreadsheetId
            + "/export?format=csv&sheet=" + URLEncoder.encode(sheetName, StandardCharsets.UTF_8));
        urlsToTry.add("https://docs.google.com/spreadsheets/d/" + spreadsheetId
            + "/gviz/tq?tqx=out:csv&sheet=" + URLEncoder.encode(sheetName, StandardCharsets.UTF_8));

        StringJoiner errors = new StringJoiner(" | ");
        HttpEntity<Void> requestEntity = buildCsvFetchRequestEntity();
        for (String csvUrl : urlsToTry) {
            try {
                ResponseEntity<String> response = restTemplate.exchange(
                    csvUrl,
                    HttpMethod.GET,
                    requestEntity,
                    String.class
                );
                String csv = response.getBody();
                if (csv == null || csv.isBlank()) {
                    errors.add("empty response");
                    continue;
                }

                String sniff = csv.trim().toLowerCase(Locale.ROOT);
                if (sniff.startsWith("<!doctype html") || sniff.startsWith("<html")) {
                    errors.add("non-csv html response");
                    continue;
                }
                return csv;
            } catch (RestClientException ex) {
                errors.add(ex.getClass().getSimpleName());
            }
        }

        throw new IllegalStateException(
            "Failed to fetch Google Sheet CSV. Make sure sharing is 'Anyone with link - Viewer', sheet tab is exact, and gid is correct. Details: " + errors
        );
    }

    private String sanitizeCsvValue(String value) {
        String v = value == null ? "" : value;
        if (v.isEmpty()) {
            return v;
        }
        char first = v.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t') {
            return "'" + v;
        }
        return v;
    }

    private boolean isAllowedGoogleSheetsUrl(String csvUrl, String spreadsheetId) {
        try {
            URI uri = URI.create(csvUrl);
            String host = uri.getHost() != null ? uri.getHost().toLowerCase(Locale.ROOT) : "";
            if (!host.equals("docs.google.com") && !host.endsWith(".google.com")) {
                return false;
            }
            String path = uri.getPath() != null ? uri.getPath() : "";
            return path.contains("/spreadsheets/d/" + spreadsheetId);
        } catch (Exception ex) {
            return false;
        }
    }

    private HttpEntity<Void> buildCsvFetchRequestEntity() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
        headers.set(HttpHeaders.ACCEPT, "text/csv,application/csv,text/plain,*/*");
        headers.set(HttpHeaders.ACCEPT_LANGUAGE, "en-US,en;q=0.9");
        headers.setCacheControl("no-cache");
        headers.setPragma("no-cache");
        headers.setAccept(List.of(MediaType.TEXT_PLAIN, MediaType.ALL));
        return new HttpEntity<>(headers);
    }

    // ── Mapping helpers ──────────────────────────────────────────

    private void includeLeadListFields(Query query) {
        query.fields()
            .include("name")
            .include("email")
            .include("phone")
            .include("company")
            .include("website")
            .include("designation")
            .include("service")
            .include("specialization")
            .include("source")
            .include("source_label")
            .include("status")
            .include("score")
            .include("priority")
            .include("deal_value")
            .include("utm_source")
            .include("utm_medium")
            .include("utm_campaign")
            .include("ai_score_value")
            .include("ai_next_action")
            .include("assigned_to")
            .include("tags")
            .include("facebook_lead_id")
            .include("facebook_form_id")
            .include("facebook_ad_id")
            .include("expected_close_timeline")
            .include("createdAt")
            .include("updatedAt")
            .include("last_contacted_at")
            .include("converted_at")
            .include("lost_reason")
            .include("follow_up_date")
            .include("reminder_15_sent_at")
            .include("reminder_45_sent_at")
            .include("reminder_60_sent_at")
            .include("escalated_at")
            .include("reassigned_at")
            .include("revenue_value");
    }

    private LeadDTO toListDTO(
        org.bson.Document d,
        Map<String, String> assignedNameById,
        Map<String, Integer> activityStageByLeadId
    ) {
        String assignedToId = assignedToIdFromDoc(d);
        String leadId = objectIdString(d);
        return LeadDTO.builder()
            .id(leadId)
            .name(d.getString("name"))
            .email(d.getString("email"))
            .phone(d.getString("phone"))
            .company(d.getString("company"))
            .website(d.getString("website"))
            .designation(d.getString("designation"))
            .service(d.getString("service"))
            .specialization(d.getString("specialization"))
            .source(enumOrNull(Lead.LeadSource.class, d.getString("source")))
            .sourceLabel(displaySourceLabel(enumOrNull(Lead.LeadSource.class, d.getString("source")), d.getString("source_label")))
            .status(enumOrNull(Lead.LeadStatus.class, d.getString("status")))
            .score(enumOrNull(Lead.LeadScore.class, d.getString("score")))
            .priority(enumOrNull(Lead.LeadPriority.class, d.getString("priority")))
            .dealValue(decimalOrNull(d.get("deal_value")))
            .utmSource(d.getString("utm_source"))
            .utmMedium(d.getString("utm_medium"))
            .utmCampaign(d.getString("utm_campaign"))
            .aiScoreValue(d.getInteger("ai_score_value"))
            .aiNextAction(d.getString("ai_next_action"))
            .assignedToId(assignedToId)
            .assignedToName(assignedToId != null ? assignedNameById.get(assignedToId) : null)
            .tags(d.getString("tags") != null && !d.getString("tags").isBlank()
                ? Arrays.asList(d.getString("tags").split(",")) : null)
            .notes(d.getString("notes"))
            .facebookLeadId(d.getString("facebook_lead_id"))
            .facebookFormId(d.getString("facebook_form_id"))
            .facebookAdId(d.getString("facebook_ad_id"))
            .expectedCloseTimeline(enumOrNull(Lead.ExpectedCloseTimeline.class, d.getString("expected_close_timeline")))
            .createdAt(docDate(d, "createdAt"))
            .updatedAt(docDate(d, "updatedAt"))
            .lastContactedAt(docDate(d, "last_contacted_at"))
            .convertedAt(docDate(d, "converted_at"))
            .lostReason(d.getString("lost_reason"))
            .followUpDate(docDate(d, "follow_up_date"))
            .reminder15SentAt(docDate(d, "reminder_15_sent_at"))
            .reminder45SentAt(docDate(d, "reminder_45_sent_at"))
            .reminder60SentAt(docDate(d, "reminder_60_sent_at"))
            .escalatedAt(docDate(d, "escalated_at"))
            .reassignedAt(docDate(d, "reassigned_at"))
            .revenueValue(decimalOrNull(d.get("revenue_value")))
            .activityStageIndex(activityStageByLeadId.get(leadId))
            .build();
    }

    private String assignedToIdFromDoc(org.bson.Document d) {
        Object ref = d.get("assigned_to");
        if (ref instanceof org.bson.Document refDoc) {
            Object id = refDoc.get("$id");
            return id != null ? id.toString() : null;
        }
        return null;
    }

    private String objectIdString(org.bson.Document d) {
        Object id = d.get("_id");
        return id != null ? id.toString() : null;
    }

    private LocalDateTime docDate(org.bson.Document d, String key) {
        Object v = d.get(key);
        if (v instanceof java.util.Date date) {
            return date.toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDateTime();
        }
        if (v instanceof LocalDateTime dateTime) {
            return dateTime;
        }
        if (v instanceof String s && !s.isBlank()) {
            try {
                return LocalDateTime.parse(s);
            } catch (Exception ignored) {
                return null;
            }
        }
        return null;
    }

    private BigDecimal decimalOrNull(Object value) {
        if (value == null) return null;
        try {
            return new BigDecimal(value.toString());
        } catch (Exception ignored) {
            return null;
        }
    }

    private <E extends Enum<E>> E enumOrNull(Class<E> cls, String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return Enum.valueOf(cls, value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private LeadDTO toDTO(Lead l, Map<String, String> assignedNameById) {
        String assignedToId = l.getAssignedTo() != null ? l.getAssignedTo().getId() : null;
        String assignedToName = assignedToId != null ? assignedNameById.get(assignedToId) : null;
        return toDTO(l, assignedToId, assignedToName);
    }

    private LeadDTO toDTO(Lead l) {
        String assignedToId = l.getAssignedTo() != null ? l.getAssignedTo().getId() : null;
        String assignedToName = l.getAssignedTo() != null ? l.getAssignedTo().getName() : null;
        return toDTO(l, assignedToId, assignedToName);
    }

    private LeadDTO toDTO(Lead l, String assignedToId, String assignedToName) {
        return LeadDTO.builder()
            .id(l.getId())
            .name(l.getName())
            .email(l.getEmail())
            .phone(l.getPhone())
            .company(l.getCompany())
            .designation(l.getDesignation())
            .service(l.getService())
            .specialization(l.getSpecialization())
            .source(l.getSource())
            .sourceLabel(displaySourceLabel(l.getSource(), l.getSourceLabel()))
            .status(l.getStatus())
            .score(l.getScore())
            .priority(l.getPriority())
            .dealValue(l.getDealValue())
            .utmSource(l.getUtmSource())
            .utmMedium(l.getUtmMedium())
            .utmCampaign(l.getUtmCampaign())
            .aiScoreValue(l.getAiScoreValue())
            .aiNextAction(l.getAiNextAction())
            .assignedToId(assignedToId)
            .assignedToName(assignedToName)
            .tags(l.getTags() != null && !l.getTags().isBlank()
                ? Arrays.asList(l.getTags().split(",")) : null)
            .notes(l.getNotes())
            .convertedAt(l.getConvertedAt())
            .lostReason(l.getLostReason())
            .followUpDate(l.getFollowUpDate())
            .revenueValue(l.getRevenueValue())
            .activityLogs(l.getActivityLogs())
            .facebookLeadId(l.getFacebookLeadId())
            .facebookFormId(l.getFacebookFormId())
            .facebookAdId(l.getFacebookAdId())
            .expectedCloseTimeline(l.getExpectedCloseTimeline())
            .reminder15SentAt(l.getReminder15SentAt())
            .reminder45SentAt(l.getReminder45SentAt())
            .reminder60SentAt(l.getReminder60SentAt())
            .escalatedAt(l.getEscalatedAt())
            .reassignedAt(l.getReassignedAt())
            .automatedCallingStatus(l.getAutomatedCallingStatus())
            .automatedCallingStatusLabel(LeadCallAutomationService.statusLabel(l.getAutomatedCallingStatus()))
            .automatedCallingAttempt(l.getAutomatedCallingAttempt())
            .nextAutomatedCallAt(l.getNextAutomatedCallAt())
            .createdAt(l.getCreatedAt())
            .updatedAt(l.getUpdatedAt())
            .lastContactedAt(l.getLastContactedAt())
            .build();
    }

    private Lead.LeadScore scoreFromTimeline(Lead.ExpectedCloseTimeline timeline) {
        return switch (timeline) {
            case DAYS_1_3 -> Lead.LeadScore.HOT;
            case DAYS_7_10 -> Lead.LeadScore.WARM;
            case DAYS_10_15_PLUS -> Lead.LeadScore.COLD;
        };
    }

    private Lead fromDTO(LeadDTO dto) {
        Lead.LeadScore resolvedScore = dto.getExpectedCloseTimeline() != null
            ? scoreFromTimeline(dto.getExpectedCloseTimeline())
            : (dto.getScore() != null ? dto.getScore() : Lead.LeadScore.COLD);

        Lead.LeadBuilder builder = Lead.builder()
            .name(dto.getName())
            .email(dto.getEmail())
            .phone(normalizePhone(dto.getPhone()))
            .company(dto.getCompany())
            .designation(dto.getDesignation())
            .service(dto.getService())
            .specialization(dto.getSpecialization())
            .source(dto.getSource())
            .sourceLabel(normalizeSourceLabel(dto.getSource(), dto.getSourceLabel()))
            .status(dto.getStatus() != null ? dto.getStatus() : Lead.LeadStatus.NEW)
            .score(resolvedScore)
            .priority(dto.getPriority() != null ? dto.getPriority() : Lead.LeadPriority.MEDIUM)
            .expectedCloseTimeline(dto.getExpectedCloseTimeline())
            .dealValue(dto.getDealValue())
            .utmSource(dto.getUtmSource())
            .utmMedium(dto.getUtmMedium())
            .utmCampaign(dto.getUtmCampaign())
            .tags(dto.getTags() != null ? String.join(",", dto.getTags()) : null)
            .notes(dto.getNotes())
            .facebookLeadId(dto.getFacebookLeadId())
            .facebookFormId(dto.getFacebookFormId())
            .facebookAdId(dto.getFacebookAdId())
            .convertedAt(dto.getConvertedAt())
            .lostReason(dto.getLostReason())
            .followUpDate(dto.getFollowUpDate())
            .revenueValue(dto.getRevenueValue())
            .activityLogs(dto.getActivityLogs());

        if (dto.getAssignedToId() != null && !dto.getAssignedToId().isBlank()) {
            userRepository.findByIdAndTenantIdAndDeletedFalse(dto.getAssignedToId(), tenantId())
                .ifPresent(builder::assignedTo);
        }

        return builder.build();
    }

    private String displaySourceLabel(Lead.LeadSource source, String sourceLabel) {
        String normalized = normalizeSourceLabel(source, sourceLabel);
        return normalized != null ? normalized : null;
    }

    private String normalizeSourceLabel(Lead.LeadSource source, String sourceLabel) {
        if (source != Lead.LeadSource.OTHER && source != Lead.LeadSource.REFERRAL) return null;
        String trimmed = sourceLabel == null ? "" : sourceLabel.trim();
        if (trimmed.isBlank()) return null;
        if (source == Lead.LeadSource.OTHER && trimmed.equalsIgnoreCase("other")) return null;
        if (source == Lead.LeadSource.REFERRAL && trimmed.equalsIgnoreCase("referral")) return null;
        return trimmed;
    }

    private String exportSourceLabel(Lead lead) {
        if (lead == null || lead.getSource() == null) return "";
        String custom = displaySourceLabel(lead.getSource(), lead.getSourceLabel());
        if (custom != null && lead.getSource() == Lead.LeadSource.REFERRAL) return "Referral: " + custom;
        return custom != null ? custom : lead.getSource().name();
    }
}
