## JobTracker - MVP

### Główny problem

Osoby szukające pracy śledzą swoje aplikacje na wielu portalach (LinkedIn, Pracuj.pl, Indeed) za pomocą arkuszy kalkulacyjnych lub Notion. Nie ma dedykowanego narzędzia, które centralizuje dane o aplikacjach, śledzi etapy rekrutacji i proaktywnie podpowiada kiedy i jak napisać follow-up. Proces jest rozproszony i łatwo stracić nad nim kontrolę.

### Najmniejszy zestaw funkcjonalności

- Rejestracja i logowanie użytkownika
- Tablica kanban z czterema kolumnami: Zainteresowany, Zaaplikowałem, Rozmowa, Odrzucony
- Ręczne dodawanie aplikacji (stanowisko, opis, firma, umiejętności, widełki, tryb pracy)
- Dodawanie oferty przez wklejenie URL (LinkedIn lub JustJoinIT) — aplikacja pobiera i parsuje ofertę do wspólnego formatu (stanowisko, opis, firma, umiejętności, widełki, tryb pracy)
- Ręczna zmiana statusu między kolumnami z automatycznym zapisem dat
- Rekomendacje follow-upów: aplikacja wykrywa które aplikacje wymagają akcji na podstawie czasu od ostatniej zmiany statusu i aktualnego etapu rekrutacji (np. brak odpowiedzi 7 dni po aplikacji, brak feedbacku 4 dni po rozmowie)
- Generowanie draftu maila follow-up przez AI na podstawie danych aplikacji (firma, stanowisko, imię rekrutera, data rozmowy)
- Zapisywanie i edycja follow-upów dla każdej aplikacji (ślad historii komunikacji)

### Co NIE wchodzi w zakres MVP

- Profil kandydata i scoring dopasowania do oferty
- Automatyczna agregacja ofert z wielu portali
- Rozszerzenie do przeglądarki
- Powiadomienia email lub push
- Integracja z kalendarzem
- Analityka i wykrywanie wzorców w aplikacjach

### Kryteria sukcesu

- Co najmniej 80% ofert jest dodawanych przez wklejenie URL, nie ręcznie — weryfikuje że parsowanie dostarcza realną wartość
- Co najmniej 70% aplikacji zmienia status co najmniej raz po dodaniu — weryfikuje że użytkownicy aktywnie śledzą postępy
- Co najmniej 60% rekomendacji follow-upu skutkuje zapisaniem follow-upu przez użytkownika — weryfikuje że decyzja domenowa jest trafna i użyteczna
