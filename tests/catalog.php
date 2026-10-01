<?php
declare(strict_types=1);
define('MAX_API_TEST_MODE', true);
require __DIR__ . '/../api-php/index.php';

// Child mode exercises the real early endpoint gate before body/env/network access.
if (isset($argv[1]) && in_array($argv[1], ['repair', 'rent'], true)) {
    unset($_ENV['MAX_LEGACY_TELEGRAM_ENABLED'], $_SERVER['MAX_LEGACY_TELEGRAM_ENABLED']);
    putenv('MAX_LEGACY_TELEGRAM_ENABLED');
    register_shutdown_function(static function () { echo "\nSTATUS=" . http_response_code(); });
    if ($argv[1] === 'repair') handle_repair();
    else handle_rental_request();
    throw new RuntimeException('Disabled legacy handler returned without response');
}

$cases = [
    ['', null],
    ['Залог возвращается после проверки инструмента.', null],
    ['Без залога для жителей Екатеринбурга.', null],
    ['<p>Залог возвращается.</p><p>Залог: 5000 ₽</p>', 5000.0],
    ['&lt;p&gt;Залог: &lt;b&gt;5&nbsp;000&lt;/b&gt; ₽&lt;/p&gt;', 5000.0],
    ['Залог: 0 ₽', 0.0],
    ['ЗАЛОГ: 12 500,50 руб.', 12500.5],
    ['Залог: уточните у менеджера', null],
    ['Залог: -100 ₽', null],
    ['Залог: 12 34 ₽', null],
    ['Залог: 5000–10000 ₽', null],
    ['Залог: 5000 ₽ — 10000 ₽', null],
    ['Залог: 5000 ₽ до 10000 ₽', null],
    ['Залог: 1,000 ₽', null],
    ['Залог: 5000', 5000.0],
    ['Залог: 5 000 рублей. Возврат после проверки.', 5000.0],
];
foreach ($cases as [$description, $expected]) {
    if (catalog_deposit($description) !== $expected) throw new RuntimeException('Deposit mismatch: ' . $description);
}
$row = ['product_id'=>'42', 'model'=>' 012E ', 'name'=>'012E Лобзик Makita', 'category_id'=>'200', 'price'=>'600', 'quantity'=>'1', 'image'=>'tools/makita.jpg', 'keyword'=>'arenda-lobzika', 'description'=>'Залог: 5000 ₽'];
$thumbCalls = [];
$thumbnail = static function ($path) use (&$thumbCalls) { $thumbCalls[] = $path; return 'https://instrumentburg.ru/image/cache/tools/makita-400x400.jpg'; };
$item = catalog_item($row, [200=>'Лобзики'], $thumbnail);
if ($item !== ['id'=>42,'article'=>'012E','name'=>'Лобзик Makita','categoryId'=>200,'category'=>'Лобзики','pricePerDay'=>600,'available'=>true,'image'=>'https://instrumentburg.ru/image/cache/tools/makita-400x400.jpg','url'=>'https://instrumentburg.ru/arenda-lobzika','deposit'=>5000.0]) throw new RuntimeException('B0 catalog projection changed');
if ($thumbCalls !== ['tools/makita.jpg']) throw new RuntimeException('Thumbnail input mismatch');
$row['name'] = 'Лобзик 012E Makita'; $row['quantity'] = '0'; $row['price'] = '0'; $row['category_id'] = null; $row['keyword'] = ''; $row['description'] = '';
$item = catalog_item($row, [], $thumbnail);
if ($item['name'] !== 'Лобзик 012E Makita' || $item['available'] !== false || $item['pricePerDay'] !== null || $item['category'] !== 'Прочее' || $item['url'] !== null || $item['deposit'] !== null) throw new RuntimeException('Unknown fields must stay unknown; only leading inventory prefix is stripped');
foreach (['repair'=>'repair.html','rent'=>'rent.html'] as $kind=>$page) {
    $lines = []; $status = 0;
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($kind), $lines, $status);
    if ($status !== 0 || end($lines) !== 'STATUS=410') throw new RuntimeException('Legacy endpoint gate failed: ' . $kind);
    $body = json_decode($lines[0], true);
    if (($body['error'] ?? '') !== 'legacy_disabled' || strpos($body['message'] ?? '', $page) === false) throw new RuntimeException('Wrong intake redirect for legacy endpoint');
}
echo "PASS ocStore item/photo/category projection, display name, numeric/unknown deposit, both legacy gates; no HTTP calls\n";
