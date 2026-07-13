# Logika biznesowa — uzasadnienie

## Reguła w jednym zdaniu

Aplikacja oblicza, które oferty wymagają follow-upu, porównując czas od ostatniej akcji użytkownika z progiem specyficznym dla statusu oferty.

---

## Co składa się na tę logikę

### Precyzja semantyczna `lastActionAt`

Dokument definiuje wprost, co resetuje licznik: zapis notatki lub zmiana statusu. I równie wprost: co go _nie_ resetuje — edycja pól (stanowisko, firma, opis, wynagrodzenie). To jest decyzja domenowa, nie techniczna. Poprawka literówki w nazwie firmy nie jest sygnałem, że użytkownik zadbał o ofertę. Zapis notatki z treścią follow-upu — już tak. Ta granica pokazuje, że twórca myślał o tym, co naprawdę oznacza „akcja" w kontekście job trackingu.

### Progi zróżnicowane per status

7 dni w Zaaplikowałem, 4 dni w Rozmowie. To nie jest arbitralne — Rozmowa to etap, gdzie cisza przez tydzień prawie zawsze oznacza odpowiedź negatywną, więc krótszy próg jest uzasadniony domenowo. Różnica między progami pokazuje, że reguła modeluje rzeczywiste zachowanie rekruterów, a nie tylko odlicza czas.

### Obliczanie on-the-fly, nie jako persystowane pole

Flaga `requiresFollowUp` nie jest przechowywana w bazie. Jest obliczana przy każdym załadowaniu dashboardu. To decyzja o tym, gdzie żyje prawda. Persystowana flaga mogłaby się rozejść ze stanem (`lastActionAt` zmienione, flaga nieodświeżona). Obliczanie on-the-fly eliminuje tę klasę błędów. To przemyślany wybór architektoniczny wynikający ze zrozumienia logiki biznesowej.

### Pasywne surfowanie rekomendacji

Użytkownik nie uruchamia raportu, nie prosi o sprawdzenie. Aplikacja sama prezentuje flagę na kanbanie przy każdym wejściu. Logika jest zintegrowana z głównym przepływem użytkownika, a nie schowana w zakładce „Analizy".

---

## Dlaczego to spełnia kryterium certyfikacji

Wymaganie mówi: _„Aplikacja podejmuje jakąś decyzję domenową: klasyfikuje, rekomenduje, waliduje, przelicza, układa plan, sprawdza warunki, generuje propozycję albo prowadzi użytkownika przez proces."_

JobTracker robi kilka z tych rzeczy jednocześnie:

- **klasyfikuje** oferty — wymaga follow-upu / nie wymaga
- **rekomenduje** akcję — napisz follow-up
- **sprawdza warunki** — czas od ostatniej akcji vs. próg
- **prowadzi użytkownika przez proces** — flagowanie → notatka → reset licznika

To nie jest lista rekordów leżących w bazie — to aktywna logika, która zmienia to, co użytkownik widzi i co powinien zrobić.

Logika biznesowa w tym projekcie jest **konkretna, opisywalna, zaimplementowalna i testowalna** — spełnia kryterium certyfikacji bez zastrzeżeń.
