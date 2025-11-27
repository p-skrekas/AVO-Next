import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, Code, Database, FileJson, MessageSquare, Zap, Server } from 'lucide-react';

interface CodeBlockProps {
  title: string;
  language: string;
  code: string;
}

function CodeBlock({ title, language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#0a0a0b] border border-[#2a2a2e] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1d] border-b border-[#2a2a2e]">
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-medium text-[#a1a1aa]">{title}</span>
          <span className="text-xs text-[#52525b] px-2 py-0.5 bg-[#27272a] rounded">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-lg text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm">
        <code className="text-[#a1a1aa]">{code}</code>
      </pre>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ icon, title, children, defaultOpen = false }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-[#121214] border border-[#2a2a2e] rounded-2xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-5 hover:bg-[#1a1a1d] transition-colors"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
          {icon}
        </div>
        <span className="flex-1 text-left text-lg font-semibold text-[#fafafa]">{title}</span>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-[#71717a]" />
        ) : (
          <ChevronRight className="w-5 h-5 text-[#71717a]" />
        )}
      </button>
      {isOpen && (
        <div className="px-5 pb-5 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

// Structured output schema for Gemini
const STRUCTURED_OUTPUT_SCHEMA = `{
  "type": "OBJECT",
  "properties": {
    "transcription": {
      "type": "STRING",
      "description": "The exact transcription of the user's speech/audio input in Greek"
    },
    "ai_response": {
      "type": "STRING",
      "description": "The conversational response to the user in Greek"
    },
    "order": {
      "type": "ARRAY",
      "description": "The current cart/order items. Include ALL items that should be in the cart after this interaction.",
      "items": {
        "type": "OBJECT",
        "properties": {
          "id": {
            "type": "STRING",
            "description": "The product ID from the catalog"
          },
          "quantity": {
            "type": "INTEGER",
            "description": "The quantity in the same unit the customer used"
          },
          "unit": {
            "type": "STRING",
            "description": "The unit type",
            "enum": ["KOYTA", "ΤΕΜΑΧΙΟ", "CAN", "ΠΕΝΤΑΔΑ", "ΚΑΣΕΤΙΝΑ"]
          }
        },
        "required": ["id", "quantity", "unit"]
      }
    }
  },
  "required": ["transcription", "ai_response", "order"]
}`;

// PHP implementation for Gemini API call
const PHP_GEMINI_CALL = `<?php
/**
 * Gemini API Service for Voice Ordering
 * Uses Google's Gemini API with structured output
 */

class GeminiService {
    private string $apiKey;
    private string $projectId;
    private string $location;
    private string $model;

    public function __construct(
        string $apiKey,
        string $projectId,
        string $location = 'us-central1',
        string $model = 'gemini-2.5-pro'
    ) {
        $this->apiKey = $apiKey;
        $this->projectId = $projectId;
        $this->location = $location;
        $this->model = $model;
    }

    /**
     * Send audio to Gemini and get structured response
     */
    public function processAudio(
        string $audioBase64,
        string $mimeType,
        string $systemPrompt,
        array $conversationHistory = []
    ): array {
        $endpoint = sprintf(
            'https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/google/models/%s:generateContent',
            $this->location,
            $this->projectId,
            $this->location,
            $this->model
        );

        // Build the request payload
        $payload = [
            'contents' => $this->buildContents($audioBase64, $mimeType, $conversationHistory),
            'systemInstruction' => [
                'parts' => [['text' => $systemPrompt]]
            ],
            'generationConfig' => [
                'responseMimeType' => 'application/json',
                'responseSchema' => $this->getResponseSchema()
            ]
        ];

        // Make the API call
        $response = $this->makeRequest($endpoint, $payload);

        // Parse and return structured response
        return $this->parseResponse($response);
    }

    /**
     * Build conversation contents with audio
     */
    private function buildContents(
        string $audioBase64,
        string $mimeType,
        array $history
    ): array {
        $contents = [];

        // Add conversation history
        foreach ($history as $message) {
            $contents[] = [
                'role' => $message['role'],
                'parts' => [['text' => $message['content']]]
            ];
        }

        // Add current audio input
        $contents[] = [
            'role' => 'user',
            'parts' => [
                [
                    'inlineData' => [
                        'mimeType' => $mimeType,
                        'data' => $audioBase64
                    ]
                ]
            ]
        ];

        return $contents;
    }

    /**
     * Get the structured output schema
     */
    private function getResponseSchema(): array {
        return [
            'type' => 'OBJECT',
            'properties' => [
                'transcription' => [
                    'type' => 'STRING',
                    'description' => 'The exact transcription of the user\\'s speech/audio input'
                ],
                'ai_response' => [
                    'type' => 'STRING',
                    'description' => 'The conversational response to the user'
                ],
                'order' => [
                    'type' => 'ARRAY',
                    'description' => 'The current cart/order items',
                    'items' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'id' => [
                                'type' => 'STRING',
                                'description' => 'The product ID from the catalog'
                            ],
                            'quantity' => [
                                'type' => 'INTEGER',
                                'description' => 'The quantity ordered'
                            ],
                            'unit' => [
                                'type' => 'STRING',
                                'description' => 'The unit type',
                                'enum' => ['KOYTA', 'ΤΕΜΑΧΙΟ', 'CAN', 'ΠΕΝΤΑΔΑ', 'ΚΑΣΕΤΙΝΑ']
                            ]
                        ],
                        'required' => ['id', 'quantity', 'unit']
                    ]
                ]
            ],
            'required' => ['transcription', 'ai_response', 'order']
        ];
    }

    /**
     * Make HTTP request to Gemini API
     */
    private function makeRequest(string $endpoint, array $payload): array {
        $ch = curl_init($endpoint);

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->getAccessToken()
            ]
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            throw new Exception("Gemini API error: HTTP $httpCode - $response");
        }

        return json_decode($response, true);
    }

    /**
     * Get OAuth access token using service account
     */
    private function getAccessToken(): string {
        // Use Google Auth Library or implement JWT signing
        // For production, use: google/auth package
        return $this->apiKey; // Simplified - use proper OAuth in production
    }

    /**
     * Parse the Gemini response
     */
    private function parseResponse(array $response): array {
        $content = $response['candidates'][0]['content']['parts'][0]['text'] ?? '';
        $data = json_decode($content, true);

        return [
            'transcription' => $data['transcription'] ?? '',
            'ai_response' => $data['ai_response'] ?? '',
            'order' => $data['order'] ?? [],
            'usage' => [
                'input_tokens' => $response['usageMetadata']['promptTokenCount'] ?? 0,
                'output_tokens' => $response['usageMetadata']['candidatesTokenCount'] ?? 0
            ]
        ];
    }
}`;

// System prompt template (synced with server/app/settings_service.py)
const SYSTEM_PROMPT_TEMPLATE = `<SYSTEM_INSTRUCTIONS>
<ROLE>You are an AI Customer Service Expert for a Greek e-commerce platform. You communicate exclusively in Greek. Your persona is professional, efficient, and warm. Your primary goal is to assist customers with order creation and management while strictly adhering to database constraints. You will be given the user audio.</ROLE>

- INPUT DATA

<catalog>
{{catalog}}
</catalog>

<current_order_state>
{{current_cart_json}}
</current_order_state>

<CRITICAL_ID_LOOKUP_PROCESS>
*******************************************
*** MANDATORY PRODUCT ID LOOKUP ***
*******************************************

For EVERY product the customer mentions, you MUST:

1. SEARCH the catalog above for the product title
2. FIND the exact row that matches
3. COPY the "id" from the FIRST column of that row
4. USE that exact ID in your order output

EXAMPLE LOOKUPS from the catalog:
- Customer says "Terea Amber" → Find row: "2","TEREA AMBER"... → Use id: "2"
- Customer says "Terea Sienna" → Find row: "5","TEREA SIENNA"... → Use id: "5"
- Customer says "Marlboro Gold εκατοστάρια" → Find row: "16","MARLBORO GOLD 100s"... → Use id: "16"
- Customer says "Marlboro Red 24" → Find row: "21","MARLBORO RED 24s"... → Use id: "21"
- Customer says "Marlboro Gold 24" → Find row: "22","MARLBORO GOLD 24s"... → Use id: "22"
- Customer says "IQOS Iluma Azure Blue" → Find row: "58","IQOS KIT ILUMA ONE - AZURE BLUE"... → Use id: "58"
- Customer says "Terea Warm Fuse" → Find row: "9","TEREA WARM FUSE"... → Use id: "9"
- Customer says "Toscanello" → Find row: "139","ΠOYPA TOSCANO TOSCANELLO"... → Use id: "139"

WRONG: Making up IDs like "85", "88", "70" without looking them up
RIGHT: Finding the actual ID from the catalog's first column

*******************************************
</CRITICAL_ID_LOOKUP_PROCESS>

- OPERATIONAL RULES & CONSTRAINTS

1. Language & Tone:
Communicate ONLY in Greek.
Tone: Helpful, polite, and professional.

2. Order Management:
ID Preservation: NEVER change the Product ID of an item already in the current_order_state.
Accumulation: The output order must contain ALL items from the current_order_state PLUS any new items added. Do not drop existing items unless explicitly asked to remove them.
Confirmation: Always ask the user if they want to add anything else or if the order is complete.

3. Specific Responses:
Delivery: If asked about delivery time/dates, reply EXACTLY with: "Η παράδοση της παραγγελίας σας θα γίνει με βάση τη συμφωνημένη Πολιτική Παράδοσης που έχετε με τους προμηθευτές σας."

4. Quantity Output Rules:
   - The quantity must ALWAYS be in the SAME UNIT that the customer used.
   - If the customer says "3 κουτιά" (3 boxes), output quantity: 3, unit: "KOYTA"
   - If the customer says "30 τεμάχια" (30 pieces), output quantity: 30, unit: "ΤΕΜΑΧΙΟ"
   - NEVER convert between units. Output exactly what the customer requested.

5. Unit values: Use "KOYTA" for boxes, "ΤΕΜΑΧΙΟ" for pieces, "CAN" for cans (ZYN products), "ΠΕΝΤΑΔΑ" for 5-packs, "ΚΑΣΕΤΙΝΑ" for cases.

</SYSTEM_INSTRUCTIONS>`;

// PHP REST endpoint example
const PHP_REST_ENDPOINT = `<?php
/**
 * Voice Order REST API Endpoint
 * POST /api/voice-order
 */

require_once 'GeminiService.php';
require_once 'ProductCatalog.php';
require_once 'SessionManager.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

try {
    // Parse request
    $input = json_decode(file_get_contents('php://input'), true);

    $sessionId = $input['session_id'] ?? uniqid('session_');
    $audioBase64 = $input['audio_base64'] ?? null;
    $mimeType = $input['mime_type'] ?? 'audio/webm';

    if (!$audioBase64) {
        throw new Exception('Audio data is required');
    }

    // Initialize services
    $gemini = new GeminiService(
        getenv('GOOGLE_API_KEY'),
        getenv('GCP_PROJECT_ID'),
        getenv('GCP_LOCATION') ?: 'us-central1',
        'gemini-2.5-pro'
    );

    $catalog = new ProductCatalog();
    $session = new SessionManager();

    // Get current cart state from session
    $currentCart = $session->getCart($sessionId);
    $conversationHistory = $session->getHistory($sessionId);

    // Build system prompt with catalog and current cart
    $systemPrompt = buildSystemPrompt(
        $catalog->getCatalogCSV(),
        $currentCart
    );

    // Process audio with Gemini
    $result = $gemini->processAudio(
        $audioBase64,
        $mimeType,
        $systemPrompt,
        $conversationHistory
    );

    // Update session with new cart state
    $session->updateCart($sessionId, $result['order']);
    $session->addToHistory($sessionId, 'user', '[Audio]');
    $session->addToHistory($sessionId, 'assistant', $result['ai_response']);

    // Enrich cart items with product names
    $enrichedCart = $catalog->enrichCartItems($result['order']);

    // Return response
    echo json_encode([
        'success' => true,
        'session_id' => $sessionId,
        'transcription' => $result['transcription'],
        'ai_response' => $result['ai_response'],
        'cart' => $enrichedCart,
        'usage' => $result['usage']
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}

/**
 * Build system prompt with dynamic data
 */
function buildSystemPrompt(string $catalogCSV, array $currentCart): string {
    $template = file_get_contents('prompts/system_prompt.txt');

    // Replace placeholders
    $prompt = str_replace('{{catalog}}', $catalogCSV, $template);
    $prompt = str_replace('{{current_cart_json}}', json_encode($currentCart), $prompt);

    return $prompt;
}`;

// Database schema
const DATABASE_SCHEMA = `-- Products table
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    units_relation INT DEFAULT 10,
    main_unit_description VARCHAR(50) DEFAULT 'ΤΕΜΑΧΙΟ',
    secondary_unit_description VARCHAR(50) DEFAULT 'KOYTA',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Sessions table (for conversation state)
CREATE TABLE sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    cart_data JSON,
    conversation_history JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Orders table (for completed orders)
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    session_id VARCHAR(100),
    customer_id VARCHAR(100),
    items JSON NOT NULL,
    total_items INT,
    status ENUM('pending', 'confirmed', 'processing', 'completed', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Order items table (normalized version)
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id VARCHAR(100) NOT NULL,
    product_id VARCHAR(50) NOT NULL,
    quantity INT NOT NULL,
    unit VARCHAR(50) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- Indexes for performance
CREATE INDEX idx_sessions_session_id ON sessions(session_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_orders_session ON orders(session_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_products_title ON products(title);`;

// Product catalog helper
const PHP_PRODUCT_CATALOG = `<?php
/**
 * Product Catalog Service
 */

class ProductCatalog {
    private PDO $db;

    public function __construct() {
        $this->db = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4',
                getenv('DB_HOST'),
                getenv('DB_NAME')
            ),
            getenv('DB_USER'),
            getenv('DB_PASS')
        );
    }

    /**
     * Get catalog as CSV string for prompt
     */
    public function getCatalogCSV(): string {
        $stmt = $this->db->query('SELECT * FROM products ORDER BY id');
        $products = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $lines = ['"id","title","units_relation","main_unit_description","secondary_unit_description"'];

        foreach ($products as $product) {
            $lines[] = sprintf(
                '"%s","%s","%s","%s","%s"',
                $product['product_id'],
                $product['title'],
                $product['units_relation'],
                $product['main_unit_description'],
                $product['secondary_unit_description']
            );
        }

        return implode("\\n", $lines);
    }

    /**
     * Enrich cart items with product names
     */
    public function enrichCartItems(array $cartItems): array {
        if (empty($cartItems)) {
            return [];
        }

        $productIds = array_column($cartItems, 'id');
        $placeholders = implode(',', array_fill(0, count($productIds), '?'));

        $stmt = $this->db->prepare(
            "SELECT product_id, title FROM products WHERE product_id IN ($placeholders)"
        );
        $stmt->execute($productIds);

        $productNames = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $productNames[$row['product_id']] = $row['title'];
        }

        return array_map(function($item) use ($productNames) {
            return [
                'product_id' => $item['id'],
                'product_name' => $productNames[$item['id']] ?? 'Unknown Product',
                'quantity' => $item['quantity'],
                'unit' => $item['unit']
            ];
        }, $cartItems);
    }

    /**
     * Search products by title
     */
    public function searchProducts(string $query, int $limit = 10): array {
        $stmt = $this->db->prepare(
            'SELECT * FROM products WHERE title LIKE ? LIMIT ?'
        );
        $stmt->execute(["%$query%", $limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}`;

// Session manager
const PHP_SESSION_MANAGER = `<?php
/**
 * Session Manager for conversation state
 */

class SessionManager {
    private PDO $db;
    private int $sessionTTL = 3600; // 1 hour

    public function __construct() {
        $this->db = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4',
                getenv('DB_HOST'),
                getenv('DB_NAME')
            ),
            getenv('DB_USER'),
            getenv('DB_PASS')
        );
    }

    /**
     * Get or create session
     */
    public function getOrCreate(string $sessionId): array {
        $stmt = $this->db->prepare(
            'SELECT * FROM sessions WHERE session_id = ? AND expires_at > NOW()'
        );
        $stmt->execute([$sessionId]);
        $session = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$session) {
            $this->create($sessionId);
            return [
                'session_id' => $sessionId,
                'cart_data' => [],
                'conversation_history' => []
            ];
        }

        return [
            'session_id' => $session['session_id'],
            'cart_data' => json_decode($session['cart_data'], true) ?? [],
            'conversation_history' => json_decode($session['conversation_history'], true) ?? []
        ];
    }

    /**
     * Create new session
     */
    public function create(string $sessionId): void {
        $expiresAt = date('Y-m-d H:i:s', time() + $this->sessionTTL);

        $stmt = $this->db->prepare(
            'INSERT INTO sessions (session_id, cart_data, conversation_history, expires_at)
             VALUES (?, "[]", "[]", ?)
             ON DUPLICATE KEY UPDATE expires_at = ?'
        );
        $stmt->execute([$sessionId, $expiresAt, $expiresAt]);
    }

    /**
     * Get current cart
     */
    public function getCart(string $sessionId): array {
        $session = $this->getOrCreate($sessionId);
        return $session['cart_data'];
    }

    /**
     * Update cart
     */
    public function updateCart(string $sessionId, array $cart): void {
        $stmt = $this->db->prepare(
            'UPDATE sessions SET cart_data = ?, updated_at = NOW() WHERE session_id = ?'
        );
        $stmt->execute([json_encode($cart), $sessionId]);
    }

    /**
     * Get conversation history
     */
    public function getHistory(string $sessionId): array {
        $session = $this->getOrCreate($sessionId);
        return $session['conversation_history'];
    }

    /**
     * Add message to history
     */
    public function addToHistory(string $sessionId, string $role, string $content): void {
        $history = $this->getHistory($sessionId);
        $history[] = ['role' => $role, 'content' => $content];

        // Keep last 20 messages
        if (count($history) > 20) {
            $history = array_slice($history, -20);
        }

        $stmt = $this->db->prepare(
            'UPDATE sessions SET conversation_history = ?, updated_at = NOW() WHERE session_id = ?'
        );
        $stmt->execute([json_encode($history), $sessionId]);
    }

    /**
     * Clear session
     */
    public function clear(string $sessionId): void {
        $stmt = $this->db->prepare('DELETE FROM sessions WHERE session_id = ?');
        $stmt->execute([$sessionId]);
    }

    /**
     * Cleanup expired sessions
     */
    public function cleanupExpired(): int {
        $stmt = $this->db->prepare('DELETE FROM sessions WHERE expires_at < NOW()');
        $stmt->execute();
        return $stmt->rowCount();
    }
}`;

// Example response
const EXAMPLE_RESPONSE = `{
  "transcription": "Θέλω δύο κούτες Terea Amber και τρία τεμάχια Marlboro Gold",
  "ai_response": "Τέλεια! Προσθέτω στην παραγγελία σας 2 κούτες TEREA AMBER και 3 τεμάχια MARLBORO GOLD. Θέλετε να προσθέσετε κάτι ακόμα;",
  "order": [
    {
      "id": "2",
      "quantity": 2,
      "unit": "KOYTA"
    },
    {
      "id": "14",
      "quantity": 3,
      "unit": "ΤΕΜΑΧΙΟ"
    }
  ]
}`;

export default function Migration() {
  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#fafafa]">PHP Migration Guide</h1>
          <p className="text-sm text-[#71717a]">Complete documentation for migrating to a PHP production backend</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Overview */}
          <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#fafafa] mb-2">Overview</h2>
            <p className="text-[#a1a1aa] text-sm leading-relaxed">
              This guide contains all the necessary information to migrate the AVO_NEXT voice ordering system
              to a production-ready PHP backend. It includes the Gemini API structured output schema,
              system prompt template, database schema, and complete PHP implementation examples.
            </p>
            <div className="flex gap-4 mt-4">
              <div className="flex items-center gap-2 text-xs text-[#71717a]">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span>Gemini 2.5 Pro</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#71717a]">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                <span>Structured JSON Output</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#71717a]">
                <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                <span>Audio Processing</span>
              </div>
            </div>
          </div>

          {/* Structured Output Schema */}
          <Section
            icon={<FileJson className="w-5 h-5 text-indigo-400" />}
            title="Structured Output Schema"
            defaultOpen={true}
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              This JSON schema defines the structure of Gemini's response. It ensures the model returns
              a consistent format with transcription, AI response, and order items.
            </p>
            <CodeBlock
              title="Response Schema"
              language="JSON"
              code={STRUCTURED_OUTPUT_SCHEMA}
            />
            <div className="mt-4 p-4 bg-[#1a1a1d] rounded-xl border border-[#2a2a2e]">
              <h4 className="text-sm font-medium text-[#fafafa] mb-2">Example Response</h4>
              <CodeBlock
                title="Sample Output"
                language="JSON"
                code={EXAMPLE_RESPONSE}
              />
            </div>
          </Section>

          {/* System Prompt */}
          <Section
            icon={<MessageSquare className="w-5 h-5 text-purple-400" />}
            title="System Prompt Template"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              The system prompt instructs the AI on how to behave. It includes placeholders for the product
              catalog (<code className="text-indigo-400">{"{{catalog}}"}</code>) and current cart state
              (<code className="text-indigo-400">{"{{current_cart_json}}"}</code>).
            </p>
            <CodeBlock
              title="System Prompt"
              language="Text"
              code={SYSTEM_PROMPT_TEMPLATE}
            />
            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <h4 className="text-sm font-medium text-amber-400 mb-2">Important Notes</h4>
              <ul className="text-sm text-[#a1a1aa] space-y-1 list-disc list-inside">
                <li>Replace <code className="text-amber-400">{"{{catalog}}"}</code> with the CSV product catalog</li>
                <li>Replace <code className="text-amber-400">{"{{current_cart_json}}"}</code> with the current cart state as JSON</li>
                <li>The prompt is designed for Greek language interactions</li>
                <li>Product IDs must be looked up from the catalog, not generated</li>
              </ul>
            </div>
          </Section>

          {/* PHP Gemini Service */}
          <Section
            icon={<Zap className="w-5 h-5 text-yellow-400" />}
            title="PHP Gemini API Service"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              Complete PHP class for calling the Gemini API with audio input and structured output.
              Handles authentication, request building, and response parsing.
            </p>
            <CodeBlock
              title="GeminiService.php"
              language="PHP"
              code={PHP_GEMINI_CALL}
            />
          </Section>

          {/* REST Endpoint */}
          <Section
            icon={<Server className="w-5 h-5 text-green-400" />}
            title="REST API Endpoint"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              Example REST endpoint that receives audio, processes it through Gemini, and returns the structured response.
            </p>
            <CodeBlock
              title="api/voice-order.php"
              language="PHP"
              code={PHP_REST_ENDPOINT}
            />
            <div className="mt-4 p-4 bg-[#1a1a1d] rounded-xl border border-[#2a2a2e]">
              <h4 className="text-sm font-medium text-[#fafafa] mb-2">Request Format</h4>
              <CodeBlock
                title="POST /api/voice-order"
                language="JSON"
                code={`{
  "session_id": "optional-session-id",
  "audio_base64": "base64-encoded-audio-data",
  "mime_type": "audio/webm"
}`}
              />
            </div>
          </Section>

          {/* Database Schema */}
          <Section
            icon={<Database className="w-5 h-5 text-blue-400" />}
            title="Database Schema (MySQL)"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              SQL schema for products, sessions, and orders tables. Includes JSON columns for flexible cart storage.
            </p>
            <CodeBlock
              title="schema.sql"
              language="SQL"
              code={DATABASE_SCHEMA}
            />
          </Section>

          {/* Product Catalog Service */}
          <Section
            icon={<FileJson className="w-5 h-5 text-pink-400" />}
            title="Product Catalog Service"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              PHP service for managing the product catalog, generating CSV for prompts, and enriching cart items with product names.
            </p>
            <CodeBlock
              title="ProductCatalog.php"
              language="PHP"
              code={PHP_PRODUCT_CATALOG}
            />
          </Section>

          {/* Session Manager */}
          <Section
            icon={<Database className="w-5 h-5 text-cyan-400" />}
            title="Session Manager"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              Manages conversation state, cart persistence, and session expiration. Essential for multi-turn conversations.
            </p>
            <CodeBlock
              title="SessionManager.php"
              language="PHP"
              code={PHP_SESSION_MANAGER}
            />
          </Section>

          {/* Environment Variables */}
          <Section
            icon={<Server className="w-5 h-5 text-orange-400" />}
            title="Environment Configuration"
          >
            <p className="text-sm text-[#a1a1aa] mb-4">
              Required environment variables for the PHP application.
            </p>
            <CodeBlock
              title=".env"
              language="Bash"
              code={`# Google Cloud / Gemini API
GOOGLE_API_KEY=your-api-key
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us-central1

# Database
DB_HOST=localhost
DB_NAME=voice_ordering
DB_USER=your_user
DB_PASS=your_password

# Session
SESSION_TTL=3600`}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
