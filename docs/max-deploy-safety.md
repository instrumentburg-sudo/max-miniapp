# MAX: передача событий, полный backup и точный откат

Это подготовленные команды. До отдельного разрешения на деплой их на production не выполнять. Скрипты не меняют подписки MAX и не вызывают bot API; MAX-memory остаётся как есть.

## Что гарантирует deploy.sh

Любой режим с записью на сервер (`all`, `--api-only`, `--frontend-only`, `--handoff-only`, `--restore`) сначала архивирует **оба текущих дерева** `/home/c50684/instrumentburg.ru/www/max-app` и `/home/c50684/instrumentburg.ru/www/max-api`. В архив входят `.htaccess`, скрытые файлы, старый frontend, незакоммиченные обработчики каталога/аренды и прочие файлы этих деревьев. Backup не подменяется git checkout. Env вне этих деревьев не меняется.

Архив находится вне www: `/home/c50684/instrumentburg.ru/max-deploy-backups/snapshot-<UTC>-<random>.tar.gz`, рядом `.sha256`. Вывод команды содержит точные `BACKUP_ARCHIVE`, `BACKUP_SHA256` и команду восстановления. Каталог backup имеет 0700, новые архивы создаются с umask 077. Перед SSH-upload/изменением PHP проверяются реальные пути (symlink корневых деревьев запрещён), целостность gzip, SHA256, обязательные файлы обоих namespace и `tar --compare` **всех** файлов с live деревьями. Ошибка останавливает deploy до изменения приложения. Архивирование может завершиться отказом, если во время него менялись файлы; повторять с новой копией после выяснения причины.

`--cabinet-artifact` исключительно локален: SSH и backup не выполняются. `--backup-only` создаёт и проверяет архив без изменения приложения.

## Порядок без нового окна двойных ответов

1. Получить разрешение на выкладку и перейти в согласованный master miniapp. До основного Convex deploy выполнить:
   ```bash
   ./deploy.sh --handoff-only
   ```
   Сохранить напечатанный путь как **B0** (точная исходная production-копия). Скрипт архивирует всё, затем вставляет только helper/ранний guard в **существующий server PHP**, проверяет `php -l`, что исходный PHP совпадает с архивом и не изменился во время patch, сохраняет mode и атомарно заменяет index.php. Остальной PHP, старые формы, dirty catalog/rental handlers и frontend не заменяются. Неизвестная сигнатура `process_bot_update`, частичный чужой patch или ошибка lint останавливают операцию.
2. Handoff подавляет только события, уже распознаваемые Convex `origin/master 1bb24212`: bot_started, официальный contact с vcf_info/hash и старую грамматику `/start` (без trim/смены регистра/@bot). Расширенные варианты остаются прежнему PHP. Это фиксированная граница совместимости: исторический ECMAScript whitespace не включает NEL; расширенный parser включает NEL и BOM явно.
3. Сразу сохранить отдельную безопасную точку отката **B1**:
   ```bash
   ./deploy.sh --backup-only
   ```
   Записать точный `BACKUP_ARCHIVE`. B1 содержит старые frontend/dirty handlers и узкий guard V2. Незнакомый/старый guard V1 не обновляется автоматически: скрипт остановится. Предыдущие подготовленные версии не выкладывались.
4. После handoff и B1 развернуть новый Convex. Его прямой MAX webhook сохраняет прежнюю грамматику; поэтому расширенные команды всё ещё обслуживает PHP. Новая широкая грамматика принимается только по подписанной PHP-пересылке. Простое расширение прямого parser на этом шаге создало бы дубли.
5. Выполнить полный miniapp `./deploy.sh`, затем self-service frontend по общему отчёту. Новый PHP молчит на legacy start/contact; расширенный start пересылает в существующий `/max/webhook` Convex. Запрос подписывается HMAC-SHA256 от точных байтов тела, timestamp и домена `ib-max-start-v1` существующим MAX_BOT_TOKEN. Новый секрет/env не нужен. Прямое событие MAX для этого же расширенного start не вызывает ответа Convex. После проверки всех версий менять mini-app URL последним.

| Промежуточное состояние | Legacy start/contact | Расширенный start | Номер заказа |
|---|---|---|---|
| Handoff + старый Convex | Convex direct | старый PHP | PHP |
| Handoff + новый Convex | Convex direct | старый PHP | PHP |
| Полный PHP + новый Convex | Convex direct | PHP forward → Convex | PHP |

В каждом состоянии один ответчик. Неуспех следующего deploy оставляет предыдущий состав работоспособным. Полный PHP нельзя выкладывать до нового Convex: у старого нет аутентифицированного forward. Подписки не меняются. При сетевой ошибке forward PHP логирует отказ без тела/секрета, не отправляет второй ответ и не повторяет запрос вслепую; это обычная недоступность доставки, а не переходное окно ничьих команд. MAX webhook retries остаются отдельным свойством доставки; exactly-once по повторным событиям здесь не обещается.

## Проверка архива и откат

Путь ниже надо заменить **точным B1 из лога**, не B0:

```bash
B1='/home/c50684/instrumentburg.ru/max-deploy-backups/snapshot-YYYYMMDDTHHMMSSZ-XXXXXXXX.tar.gz'
ssh c50684@h31.netangels.ru bash -s -- /home/c50684/instrumentburg.ru verify "$B1" < scripts/max-snapshot.sh
./deploy.sh --restore "$B1"
```

`--restore` сначала создаёт ещё один полный backup текущего состояния. Затем проверяет B1, распаковывает вне www, переносит текущие два дерева в `max-deploy-backups/replaced-XXXXXXXX`, устанавливает оба дерева из B1 и сравнивает их с архивом. Это замена деревьев, поэтому новые файлы/handlers не остаются после отката. При обычной ошибке и сигналах HUP/INT/TERM shell trap возвращает перемещённые исходные деревья; повторные сигналы на время rollback игнорируются. Перед первым переносом проверяется общий filesystem и печатаются точные `RESTORE_STAGE`/`RESTORE_DISPLACED`. Старые деревья не удаляются скриптом. Для неуловимого `kill -9` или выключения хоста нужен ручной порядок ниже.

B1 сохраняет ownership guard: новый Convex может временно остаться развёрнутым без двойных ответов PHP. После восстановления проверить старый кабинет/health без создания заявок и вернуть mini-app URL `https://instrumentburg.ru/max-app/`, если его уже меняли. Откат self-service/Convex выполнять отдельно по их отчёту. B0 хранится как исходная историческая копия; **не использовать B0 как обычный rollback**, поскольку он возвращает прежнее дублирование стартов/контактов.

## Ручное восстановление после kill -9 / сбоя хоста

SIGKILL и отключение питания нельзя перехватить. Не запускайте deploy повторно, пока оба дерева не восстановлены. Сначала убедитесь, что прежний restore-процесс завершён, и в логе **прерванного запуска** найдите `RESTORE_DISPLACED` (не выбирайте «последний» каталог по glob). Эта директория содержит деревья, перемещённые именно тем запуском. `RESTORE_STAGE` содержит распакованные backup-деревья и возможные `failed-*`; ничего из них не удаляйте.

После разрешённого SSH-входа выполните следующий блок в отдельном bash, подставив точное значение `RESTORE_DISPLACED`:

```bash
bash
set -euo pipefail
trap '' HUP INT TERM
ROOT='/home/c50684/instrumentburg.ru'
DISPLACED='/home/c50684/instrumentburg.ru/max-deploy-backups/replaced-XXXXXXXX'
[[ "$DISPLACED" == "$ROOT"/max-deploy-backups/replaced-* ]]
[[ -d "$DISPLACED" && ! -L "$DISPLACED" && "$(realpath -e "$DISPLACED")" == "$DISPLACED" ]]
[[ -d "$ROOT/www" && ! -L "$ROOT/www" && "$(realpath -e "$ROOT/www")" == "$ROOT/www" ]]
SAVED="$(mktemp -d "$ROOT/max-deploy-backups/manual-recovery-XXXXXXXX")"
for name in max-app max-api; do
  [[ ! -L "$ROOT/www/$name" && ! -L "$DISPLACED/$name" ]]
  if [[ -d "$DISPLACED/$name" ]]; then
    if [[ -e "$ROOT/www/$name" ]]; then
      mv -- "$ROOT/www/$name" "$SAVED/$name"
    fi
    mv -- "$DISPLACED/$name" "$ROOT/www/$name"
  else
    [[ -d "$ROOT/www/$name" ]] || {
      echo "Нет обоих экземпляров $name: остановитесь, используйте проверенный полный архив" >&2
      exit 1
    }
  fi
done
[[ -f "$ROOT/www/max-app/index.html" && -f "$ROOT/www/max-api/index.php" ]]
[[ -f "$ROOT/www/max-app/.htaccess" && -f "$ROOT/www/max-api/.htaccess" ]]
printf 'Восстановлены оба дерева; отложенные файлы: %s\n' "$SAVED"
exit
```

Этот блок возвращает **оба дерева текущей версии до прерванного restore**, включая уже успевшее восстановиться из backup дерево: иначе получится смесь версий. Если в `DISPLACED` нет одного дерева, а в `www` оно есть, значит этот перенос ещё не состоялся либо rollback уже вернул его; оставляем его на месте. После проверок обоих входов и PHP health можно снова выполнить штатный restore выбранного B1. Если точный `RESTORE_DISPLACED` неизвестен или потеряны обе копии дерева, не угадывайте: используйте проверенный полный архив с ручной распаковкой в отдельный staging и проверкой содержимого до публикации.

## Локальный тест без production

```bash
python3 tests/deploy-safety.py
python3 tests/deploy-interruptions.py
node tests/ownership-matrix.cjs /absolute/path/to/mono
bash -n deploy.sh scripts/max-snapshot.sh
php -l scripts/max-handoff.php
```

Тест подставляет SSH/SCP/CURL стабы, создаёт временные деревья со скрытыми файлами и dirty handler, проверяет обязательность backup до upload, остановку при ошибке backup, узкий/idempotent handoff без HTTP отправок, сохранение free-text lookup, общие start-фикстуры, включая NBSP/BOM/NEL, с проверкой исторической границы handoff, точный restore и отказ при повреждённом архиве/подменённом symlink пути. Ни одна команда теста не обращается к настоящему SSH/API.
