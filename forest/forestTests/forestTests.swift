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
        #expect(Service.validURL("https://forest.example")?.host == "forest.example")
        #expect(Service.validURL(" http://localhost:3000 ")?.port == 3000)
        for address in ["http://forest.example", "https://user:password@forest.example", "https://forest.example/api", "https://forest.example?token=secret", "not a URL"] {
            #expect(Service.validURL(address) == nil)
        }
    }

    @Test func decodesServerEventContract() throws {
        let data = Data("""
        [{"id":"golf-jeju","type":"golf","name":"제주 프리미엄 투어 라운딩","capacity":8,"remaining":0}]
        """.utf8)
        let events = try JSONDecoder().decode([Event].self, from: data)
        #expect(events.first?.remaining == 0)
        #expect(Event.examples.allSatisfy { $0.remaining == nil })
    }

}
