//
//  forestTests.swift
//  forestTests
//
//  Created by  linkgenesis on 10/8/26.
//

import Testing
import Foundation
@testable import forest

struct forestTests {

    @MainActor @Test func serverAddressValidation() throws {
        #expect(try ClubStore.validatedURL("https://forest.example").host == "forest.example")
        #expect(try ClubStore.validatedURL(" http://localhost:3000 ").port == 3000)
        for address in ["http://forest.example", "https://user:password@forest.example", "https://forest.example/api", "https://forest.example?token=secret", "not a URL"] {
            #expect(throws: ClubError.self) { try ClubStore.validatedURL(address) }
        }
    }

    @Test func decodesServerEventContract() throws {
        let data = Data("""
        [{"id":"golf-jeju","type":"golf","name":"제주 프리미엄 투어 라운딩","capacity":8,"remaining":0}]
        """.utf8)
        let events = try JSONDecoder().decode([ClubEvent].self, from: data)
        #expect(events.first?.remaining == 0)
        #expect(ClubEvent.examples.allSatisfy { $0.remaining == nil })
    }

}
