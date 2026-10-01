<?php
declare(strict_types=1);
define('MAX_API_TEST_MODE', true);
require __DIR__ . '/../api-php/index.php';
$called = [];
$respond = static function ($id, $text) use (&$called) { $called[] = [$id, $text]; };
$message = static fn($text, $attachments = []) => ['update_type' => 'message_created', 'message' => ['sender' => ['user_id' => 123], 'body' => ['text' => $text, 'attachments' => $attachments]]];
foreach ([['update_type' => 'bot_started', 'user_id' => 123], $message('/start'), $message('/start abc'), $message('/start=token'), $message('/start@bot=token'), $message('start'), $message(''), $message('A023222', [['type' => 'contact']]), $message('', [['type' => 'contact']])] as $update) {
    process_bot_update($update, $respond);
}
if ($called !== []) throw new RuntimeException('PHP replied to a Convex-owned event');
process_bot_update($message('Мой заказ А023222'), $respond);
process_bot_update($message('Здравствуйте'), $respond);
if (count($called) !== 2 || $called[0] !== [123, 'Мой заказ А023222']) throw new RuntimeException('Text lookup was lost');
if (env('MAX_LEGACY_TELEGRAM_ENABLED') === '1') throw new RuntimeException('Run tests without emergency flag');
echo "PASS webhook ownership, contact caption suppression, text dispatch; no HTTP sends\n";

$fixtures = json_decode(file_get_contents(__DIR__ . '/start-commands.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($fixtures as $fixture) {
    $start = max_start_command($fixture['text']);
    if (($start !== null) !== $fixture['start'] || ($start[1] ?? null) !== $fixture['payload']) {
        throw new RuntimeException('Start grammar mismatch: ' . json_encode($fixture));
    }
    $called = [];
    process_bot_update($message($fixture['text']), $respond);
    $expected = $fixture['start'] || trim($fixture['text']) === '' ? 0 : 1;
    if (count($called) !== $expected) throw new RuntimeException('Start ownership mismatch: ' . json_encode($fixture));
}
echo 'PASS ' . count($fixtures) . " shared start variants and payloads; PHP defers every recognized start to Convex\n";
