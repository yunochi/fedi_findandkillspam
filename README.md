# fedi_findandkillspam (Yunochi 커스텀)

## 사용법
1. 설정을 합니다
    - **config.json**을 열고 값을 수정합니다
    ```jsonc
    {
        "Mastodon": false,  // <-- 마스토돈이라면, true로 설정하세요
        "Misskey": false,   // <-- 미스키라면, true로 설정하세요
        "Misskey_StreamName": "" ,// <-- 미스키의 노트 스트리밍 채널을 변경하려는 경우 설정하세요. (설정하지 않으면 globalTimeline)


        "Misskey_ShouldBanUser": true, // <--   // 미스키에서, 스팸을 올린 사용자를 자동으로 정지할지 정합니다.
                                                // false일 경우 노트만 삭제하고 사용자를 정지하지는 않습니다.
                                                // (마스토돈에서는 노트 삭제를 지원하지 않습니다. 그래서 항상 정지합니다.)
                                                
        "badPostTextRegex": [], // <- 스팸 키워드를 정규식으로 설정
        "badPostQrTextRegex": [], // <- 스팸 QR코드의 내용을 정규식으로 설정

        "Site": "https://instancename.example.com/",  // <-- 인스턴스의 주소를 넣으세요
        "ApiKey": "???????"  // <-- API 액세스 토큰을 넣으세요 (아래 설명 참조)
    }
    ```
2. `docker compose build` 를 사용하여 빌드 후, `docker compose up -d` 를 사용하여 컨테이너를 실행합니다. 
3. 로그를 보려면 `docker compose logs` 를 사용합니다. 


## 비고

### - 유놋치 커스텀: 포크해서 제가 쓸 기능들 추가하고 이것저것 암튼 함
미스키에서만 일단 테스트 되었습니다. 